import React from 'react';
import { LiveTerminalPage } from './pages/LiveTerminalPage.jsx';
import { ReplayTerminalPage } from './pages/ReplayTerminalPage.jsx';
import { QuantWorkspacePage } from './pages/QuantWorkspacePage.jsx';

export function App() {
  const path = window.location.pathname;
  if (path === '/history' || path === '/replay') return <ReplayTerminalPage />;
  if (path === '/quant') return <QuantWorkspacePage />;
  return <LiveTerminalPage />;
}
