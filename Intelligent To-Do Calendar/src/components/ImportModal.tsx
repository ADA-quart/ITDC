import React, { useState } from 'react';
import { Modal, Upload, Input, Button, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { calendarApi } from '../api/client';

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

const ImportModal: React.FC<Props> = ({ open, onClose, onImported }) => {
  const [file, setFile] = useState<File | null>(null);
  const [calendarName, setCalendarName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleImport = async () => {
    if (!file) {
      message.warning('请选择 .ics 文件');
      return;
    }
    setLoading(true);
    try {
      const result = await calendarApi.importIcs(file, calendarName || undefined);
      message.success(`导入成功，共 ${result.imported_count} 个事件`);
      setFile(null);
      setCalendarName('');
      onImported();
      onClose();
    } catch (err: any) {
      message.error(err?.response?.data?.error || '导入失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="导入 iCal 日历"
      open={open}
      onOk={handleImport}
      onCancel={() => { setFile(null); setCalendarName(''); onClose(); }}
      okText="导入"
      cancelText="取消"
      confirmLoading={loading}
    >
      <div style={{ marginBottom: 16 }}>
        <Upload
          beforeUpload={(f) => {
            if (!f.name.endsWith('.ics')) {
              message.error('请上传 .ics 文件');
              return Upload.LIST_IGNORE;
            }
            setFile(f);
            return false;
          }}
          maxCount={1}
          onRemove={() => setFile(null)}
          accept=".ics"
        >
          <Button icon={<UploadOutlined />}>选择 .ics 文件</Button>
        </Upload>
      </div>
      <Input
        placeholder="日历名称 (可选)"
        value={calendarName}
        onChange={(e) => setCalendarName(e.target.value)}
        style={{ marginBottom: 8 }}
      />
    </Modal>
  );
};

export default ImportModal;
