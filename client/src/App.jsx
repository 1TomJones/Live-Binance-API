import React from 'react';
import { LiveTerminalPage } from './pages/LiveTerminalPage.jsx';
import { ReplayTerminalPage } from './pages/ReplayTerminalPage.jsx';

export function App() {
  const path = window.location.pathname;
  if (path === '/history' || path === '/replay') {
    return <ReplayTerminalPage />;
  }
  return <LiveTerminalPage />;
}
