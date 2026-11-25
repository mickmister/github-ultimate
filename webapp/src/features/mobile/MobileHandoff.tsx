import { useEffect, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { mobileHandoff } from '../../../../src/mobile-handoff';
import { MobileHandoffView } from './MobileHandoff.view';
import './mobile-handoff.css';

export function MobileHandoff() {
  const route = useRouterState({ select: state => state.location.href });
  const [handoff, setHandoff] = useState<ReturnType<typeof mobileHandoff>>();
  const [notice, setNotice] = useState('');
  useEffect(() => {
    setHandoff(mobileHandoff(window.location.href, navigator.userAgent, navigator.maxTouchPoints));
    setNotice('');
  }, [route]);
  return handoff ? <MobileHandoffView {...handoff} notice={notice} onOpen={() => setNotice('Opening Alohak requested. If you remain here, check that Alohak is installed and your browser permits opening apps. You can continue in this browser.')} /> : null;
}
