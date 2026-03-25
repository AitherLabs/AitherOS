import PageContainer from '@/components/layout/page-container';
import React from 'react';
import { OverviewStats } from './overview-stats';

export default function OverViewLayout() {
  return (
    <PageContainer>
      <div className='flex flex-1 flex-col space-y-4'>
        <OverviewStats />
      </div>
    </PageContainer>
  );
}
