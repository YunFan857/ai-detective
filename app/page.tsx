import { Suspense } from 'react';
import { HomeBackground } from '@/components/home/home-background';
import { HomeHero } from '@/components/home/home-hero';
import { HomeInputCard } from '@/components/home/home-input-card';
import { HistoryCases } from '@/components/home/history-cases';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export default function HomePage() {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-paper pb-14">
      <ErrorBoundary label="首页背景">
        <HomeBackground />
      </ErrorBoundary>
      <div className="relative">
        <ErrorBoundary label="首页标题">
          <HomeHero />
        </ErrorBoundary>
        <ErrorBoundary label="报案单">
          <Suspense fallback={null}>
            <HomeInputCard />
          </Suspense>
        </ErrorBoundary>
        <ErrorBoundary label="历史卷宗">
          <HistoryCases />
        </ErrorBoundary>
      </div>
    </main>
  );
}
