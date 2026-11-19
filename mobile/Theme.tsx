import React, { createContext, useContext } from 'react';
import { Pressable, Text as NativeText, TextInput as NativeTextInput, Switch as NativeSwitch, View as NativeView, type ButtonProps, type TextProps, type TextInputProps, type SwitchProps, type ViewProps } from 'react-native';
import { darkShell, shellPalettes } from '../src/mobile-theme';

export const ShellThemeContext = createContext(shellPalettes.light);
export function Text(props: TextProps) {
  const theme = useContext(ShellThemeContext);
  return <NativeText {...props} style={[{ color: theme.text }, props.style]} />;
}
export function View(props: ViewProps) {
  const theme = useContext(ShellThemeContext);
  return <NativeView {...props} style={[{ borderColor: theme.border }, props.style]} />;
}
export function TextInput(props: TextInputProps) {
  const theme = useContext(ShellThemeContext);
  return <NativeTextInput placeholderTextColor={theme.muted} selectionColor={theme.accent} keyboardAppearance={darkShell(theme) ? 'dark' : 'light'} {...props} style={[{ color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }, props.style]} />;
}
export function Switch(props: SwitchProps) {
  const theme = useContext(ShellThemeContext);
  return <NativeSwitch trackColor={{ false: theme.border, true: theme.accent }} thumbColor={theme.surface} {...props} />;
}
export function Button({ title, color, ...props }: ButtonProps) {
  const theme = useContext(ShellThemeContext);
  return <Pressable {...props} accessibilityRole="button" accessibilityState={{ disabled: !!props.disabled }} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', padding: 10, borderRadius: 4, backgroundColor: pressed ? theme.selected : theme.surface, opacity: props.disabled ? .45 : 1 })}>
    <NativeText style={{ color: color ?? theme.accent, textAlign: 'center', fontWeight: '600' }}>{title}</NativeText>
  </Pressable>;
}
