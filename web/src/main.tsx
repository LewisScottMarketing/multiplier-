import '@fontsource-variable/inter/wght.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { setUnauthorizedHandler } from './api';
import './styles.css';
import { UiProvider } from './ui';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000 } },
});
// any 401 from the API means the session ended: drop the cached user so the login screen shows
setUnauthorizedHandler(() => queryClient.setQueryData(['me'], null));

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <UiProvider>
        <App />
      </UiProvider>
    </BrowserRouter>
  </QueryClientProvider>,
);
