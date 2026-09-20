import { getBooks, getMovies, getMusic } from "@/lib/catalog";
import { backendBaseUrl } from "@/lib/backend";
import { CatalogApp } from "@/components/catalog-app";
import GlitchText from "@/components/GlitchText";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  try {
    const [music, movies, books] = await Promise.all([getMusic(), getMovies(), getBooks()]);

    return <CatalogApp initialMusic={music} initialMovies={movies} initialBooks={books} />;
  } catch {
    return <BackendOffline />;
  }
}

function BackendOffline() {
  return (
    <main className="backend-offline-screen">
      <GlitchText className="backend-offline-logo" speed={2.4} enableShadows enableOnHover={false}>
        MyCatalog
      </GlitchText>

      <section className="backend-offline-banner" role="alert" aria-live="polite">
        <div className="backend-offline-status">
          <span className="backend-offline-dot" aria-hidden="true" />
          <span>Backend offline</span>
        </div>
        <p>Start the local backend and refresh this page.</p>
        <code>{backendBaseUrl}</code>
      </section>
    </main>
  );
}
