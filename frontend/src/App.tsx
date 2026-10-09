import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Home, { ThemeToggle } from './routes/Home';

const qc = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">Kou<span>Tube</span></div>
          <ThemeToggle />
        </header>
        <Home />
      </div>
    </QueryClientProvider>
  );
}
