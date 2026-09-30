package io.github.adaquart.itdc.widget;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 本机密钥保险箱。
 *
 * 本机模式要用大模型 API Key，但 WebView 的 IndexedDB / localStorage 是明文存储，
 * 备份或 root 后可直接读走。这里改用 Android Keystore：
 * AES 密钥生成在系统密钥库内且**不可导出**，密文（IV + AES-GCM 结果）才落盘到
 * 应用私有的 SharedPreferences，其它 App 与备份都拿不到密钥本身。
 *
 * 解密失败（换机、清除密钥库、数据被改）按「未保存」处理，让用户重新填一次，
 * 而不是抛异常卡住设置页。
 */
final class SecureStore {

    private static final String TAG = "ITDCSecureStore";
    private static final String PREFS = "itdc_secure";
    private static final String KEY_ALIAS = "itdc_secure_v1";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final int GCM_TAG_BITS = 128;
    private static final int GCM_IV_BYTES = 12;

    private SecureStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey secretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);
        KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }

        KeyGenerator generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }

    static void put(Context context, String name, String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, secretKey());
        byte[] iv = cipher.getIV();
        byte[] encrypted = cipher.doFinal((value == null ? "" : value).getBytes(StandardCharsets.UTF_8));

        byte[] packed = new byte[iv.length + encrypted.length];
        System.arraycopy(iv, 0, packed, 0, iv.length);
        System.arraycopy(encrypted, 0, packed, iv.length, encrypted.length);

        prefs(context).edit()
                .putString(name, Base64.encodeToString(packed, Base64.NO_WRAP))
                .apply();
    }

    static String get(Context context, String name) {
        String stored = prefs(context).getString(name, null);
        if (stored == null) return null;
        try {
            byte[] packed = Base64.decode(stored, Base64.NO_WRAP);
            if (packed.length <= GCM_IV_BYTES) return null;

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, secretKey(),
                    new GCMParameterSpec(GCM_TAG_BITS, packed, 0, GCM_IV_BYTES));
            byte[] plain = cipher.doFinal(packed, GCM_IV_BYTES, packed.length - GCM_IV_BYTES);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (Exception e) {
            Log.e(TAG, "解密失败，按未保存处理", e);
            return null;
        }
    }

    static void remove(Context context, String name) {
        prefs(context).edit().remove(name).apply();
    }
}
