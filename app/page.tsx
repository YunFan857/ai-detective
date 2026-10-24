import { HomeHero } from '@/components/home/home-hero';
import { HomeInputCard } from '@/components/home/home-input-card';
import { HistoryCases } from '@/components/home/history-cases';

export default function HomePage() {
  return (
    <main className="paper-bg relative min-h-dvh overflow-hidden pb-14">
      <HomeHero />
      <HomeInputCard />
      <HistoryCases />
    </main>
  );
}
