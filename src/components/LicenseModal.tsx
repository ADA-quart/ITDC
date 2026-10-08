import React, { useMemo, useState } from 'react';
import { Button, Input, Modal, Tag } from 'antd';
import { LinkOutlined } from '@ant-design/icons';
import { THIRD_PARTY_LICENSES } from '../data/third-party-licenses';
import { useI18n } from '../i18n';
import { useTheme } from '../contexts/ThemeContext';

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenExternal: (url: string) => void;
}

/** 协议标签配色：宽松协议绿系，MPL 这类文件级 copyleft 单独标橙 */
const LICENSE_COLORS: Record<string, string> = {
  MIT: 'green',
  ISC: 'green',
  '0BSD': 'green',
  'Apache-2.0': 'blue',
  'BSD-3-Clause': 'cyan',
  'MPL-2.0': 'orange',
};

const LicenseModal: React.FC<Props> = ({ open, onClose, onOpenExternal }) => {
  const { t, locale } = useI18n();
  const { isDark } = useTheme();
  const [keyword, setKeyword] = useState('');

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return THIRD_PARTY_LICENSES;
    return THIRD_PARTY_LICENSES.filter(
      (p) => p.name.toLowerCase().includes(k) || p.license.toLowerCase().includes(k),
    );
  }, [keyword]);

  const muted = isDark ? '#999' : '#666';

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
      title={t.settings.licenseTitle}
      styles={{ body: { maxHeight: '68vh', overflowY: 'auto', paddingTop: 8 } }}
    >
      <p style={{ fontSize: 12, color: muted, marginTop: 0 }}>{t.settings.licenseIntro}</p>
      <Input
        allowClear
        size='small'
        placeholder={t.settings.licenseSearch}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        style={{ marginBottom: 10 }}
      />
      {filtered.length === 0 ? (
        <p style={{ fontSize: 13, color: muted, textAlign: 'center', padding: '16px 0' }}>
          {locale === 'zh' ? '没有匹配的软件包' : 'No matching packages'}
        </p>
      ) : (
        filtered.map((p) => (
          <div
            key={`${p.name}@${p.version}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 2px',
              borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
            }}
          >
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 13,
              }}
            >
              {p.name}
              <span style={{ color: muted, fontSize: 12, marginLeft: 6 }}>{p.version}</span>
            </span>
            <Tag color={LICENSE_COLORS[p.license]} style={{ marginInlineEnd: 0, fontSize: 11 }}>
              {p.license}
            </Tag>
            <Button
              type='text'
              size='small'
              icon={<LinkOutlined />}
              disabled={!p.repo}
              onClick={() => void onOpenExternal(p.repo)}
            />
          </div>
        ))
      )}
      <p style={{ fontSize: 12, color: muted, margin: '10px 0 0' }}>
        {locale === 'zh' ? `共 ${filtered.length} 个开源包` : `${filtered.length} packages`}
        {' · '}
        PolyForm Noncommercial 1.0.0 © 2026 ADA-quart
      </p>
    </Modal>
  );
};

export default LicenseModal;
