import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from '@/store';
import { DataProvider } from '@/mock/DataContext';
import { RecoveryProvider } from '@/features/recovery/RecoveryContext';
import { ToastProvider } from '@/components/ui/toast';
import App from '@/App';
import { hydrateMockUsersFromBook } from '@/lib/mockUsers';
import './index.css';

hydrateMockUsersFromBook();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <DataProvider>
        <RecoveryProvider>
          <ToastProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ToastProvider>
        </RecoveryProvider>
      </DataProvider>
    </Provider>
  </React.StrictMode>
);
