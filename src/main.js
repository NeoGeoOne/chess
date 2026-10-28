import React from 'react';
import { createRoot } from 'react-dom/client';
import Component from './logic.js';

const h = React.createElement;

// A render error must never leave a blank page: offer reload and a reset of the saved data.
class ErrorBoundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { console.error('chess: render error', err); }
  reset = () => {
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('chess_')) localStorage.removeItem(k); } catch (e) { }
    location.reload();
  };
  render() {
    if (!this.state.err) return this.props.children;
    const btn = { padding: '10px 18px', border: '1px solid currentColor', background: 'transparent', color: 'inherit', font: 'inherit', borderRadius: '6px', cursor: 'pointer', marginRight: '10px' };
    return h('div', { style: { maxWidth: '520px', margin: '80px auto', padding: '0 24px', fontSize: '15px', lineHeight: 1.6 } },
      h('h1', { style: { fontSize: '28px', letterSpacing: '-.02em', margin: '0 0 12px' } }, 'Something went wrong.'),
      h('p', null, 'The page hit an error it could not recover from. Reloading usually fixes it. If it keeps happening, reset the saved data (your settings and local stats).'),
      h('p', null, h('button', { style: btn, onClick: () => location.reload() }, 'Reload'), h('button', { style: btn, onClick: this.reset }, 'Reset saved data and reload')));
  }
}

createRoot(document.getElementById('app')).render(
  h(ErrorBoundary, null, h(Component, { accentColor: '#2952e3', defaultBotLevel: 4, defaultTimeControl: '10+5' })));
