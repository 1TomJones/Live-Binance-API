import React from 'react';
import { LiveTerminalPage } from './pages/LiveTerminalPage.jsx';
import { QuantWorkspacePage } from './pages/QuantWorkspacePage.jsx';
import { MLDemoPage } from './pages/MLDemoPage.jsx';

export function App() {
  const path = window.location.pathname;
  if (path === '/quant') return <QuantWorkspacePage />;
  if (path === '/demo') return <MLDemoPage />;
  return <LiveTerminalPage />;
}
