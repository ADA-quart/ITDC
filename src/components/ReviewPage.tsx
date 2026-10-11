// © 2026 ADA-Quart & TyTs · 日日新（ITDC）· PolyForm Noncommercial 1.0.0 · github.com/ADA-quart/ITDC

import React, { useState } from 'react';
import { Segmented } from 'antd';
import DailyReview from './DailyReview';
import WeeklyReview from './WeeklyReview';
import { useI18n } from '../i18n';
import { PageHeader } from './PageBlocks';

/** 「回顾」页：今天 / 本周 两个视图 */
const ReviewPage: React.FC = () => {
  const { t } = useI18n();
  const [view, setView] = useState<'day' | 'week'>('day');

  return (
    <div>
      <PageHeader title={t.nav.review} />
      <Segmented
        value={view}
        onChange={(v) => setView(v as 'day' | 'week')}
        options={[
          { label: t.review.dayView, value: 'day' },
          { label: t.review.weekView, value: 'week' },
        ]}
        style={{ marginBottom: 12 }}
      />
      {view === 'day' ? <DailyReview /> : <WeeklyReview />}
    </div>
  );
};

export default ReviewPage;
