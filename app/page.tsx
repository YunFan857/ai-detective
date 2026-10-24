import { HomeBackground } from '@/components/home/home-background';
import { HomeHero } from '@/components/home/home-hero';
import { HomeInputCard } from '@/components/home/home-input-card';
import { HistoryCases } from '@/components/home/history-cases';

export default function HomePage() {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-paper pb-14">
      <HomeBackground />
      <div className="relative">
        <HomeHero />
        <HomeInputCard />
        <HistoryCases />
      </div>
    </main>
  );
}
