import React from 'react';
import { createRoot } from '../../../webapp/node_modules/react-dom/client';
import { ChatGPTConnections } from '../../../mobile/ChatGPTConnections';
import { changeAppState } from './native-ui';
window.__appState = changeAppState;
const root = createRoot(document.getElementById('root'));
window.__settingsVisible = visible => root.render(visible ? <ChatGPTConnections grant={{ origin: 'https://agent.example', subpath: '/pi-web/' }} /> : null);
window.__settingsVisible(true);
