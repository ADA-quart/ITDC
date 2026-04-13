import React, { useState } from 'react';
import { Modal, Upload, Input, Button, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { calendarApi } from '../api/client';
import { useI18n } from '../i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

const ImportModal: React.FC<Props> = ({ open, onClose, onImported }) => {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [calendarName, setCalendarName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleImport = async () => {
    if (!file) {
      message.warning(t.calendar.icsOnly);
      return;
    }
    setLoading(true);
    try {
      const result = await calendarApi.importIcs(file, calendarName || undefined);
      message.success(t.calendar.imported.replaceAll('{count}', String(result.imported_count)));
      setFile(null);
      setCalendarName('');
      onImported();
      onClose();
    } catch (err: any) {
      message.error(err?.response?.data?.error || t.calendar.importFailed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t.calendar.importIcal}
      open={open}
      onOk={handleImport}
      onCancel={() => { setFile(null); setCalendarName(''); onClose(); }}
      okText={t.calendar.importIcal}
      cancelText={t.calendar.cancel}
      confirmLoading={loading}
    >
      <div style={{ marginBottom: 16 }}>
        <Upload
          beforeUpload={(f) => {
            if (!f.name.endsWith('.ics')) {
              message.error(t.calendar.icsOnly);
              return Upload.LIST_IGNORE;
            }
            setFile(f);
            return false;
          }}
          maxCount={1}
          onRemove={() => setFile(null)}
          accept=".ics"
        >
          <Button icon={<DownloadOutlined />}>.ics</Button>
        </Upload>
      </div>
      <Input
        placeholder={t.calendar.calendarName}
        value={calendarName}
        onChange={(e) => setCalendarName(e.target.value)}
        style={{ marginBottom: 8 }}
      />
    </Modal>
  );
};

export default ImportModal;
