import React from 'react';
import { createRoot } from '../../../webapp/node_modules/react-dom/client';
import GitHubConnections from '../../../mobile/GitHubConnections';
createRoot(document.getElementById('root')).render(<GitHubConnections grant={{ origin: 'https://agent.example', subpath: '/app/' }} />);
