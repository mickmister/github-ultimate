import React from 'react';
const listeners = new Set();
export const AppState = { currentState: 'active', addEventListener: (_event, listener) => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; } };
export function changeAppState(state) { AppState.currentState = state; for (const listener of listeners) listener(state); }
export const Linking = { openURL: async url => { window.__verificationURL = url; } };
export const StyleSheet = { create: styles => styles };
function style(value) { return Array.isArray(value) ? Object.assign({}, ...value.map(style)) : value; }
export function View({ children, style: value }) { return <div style={style(value)}>{children}</div>; }
export function Text({ children, accessibilityRole }) { return <div role={accessibilityRole === 'header' ? 'heading' : accessibilityRole}>{children}</div>; }
export function TextInput({ accessibilityLabel, value, editable, onChangeText, style: valueStyle }) { return <input aria-label={accessibilityLabel} value={value} disabled={editable === false} onChange={event => onChangeText(event.target.value)} style={style(valueStyle)} />; }
export function Pressable({ children, disabled, onPress, style: value }) { return <button disabled={disabled} onClick={onPress} style={typeof value === 'function' ? value({ pressed: false }) : style(value)}>{children}</button>; }
export function Switch() { return null; }
