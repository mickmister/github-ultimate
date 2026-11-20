import { createElement, type ReactNode } from 'react';
import { CustomizationContext, useCustomizationFeature, useCustomizationModel } from './Customization.hooks';
import { CustomizationPresentation } from './Customization.presentation';

// Keep this host above route and device-presentation swaps.
export function CustomizationProvider({ children }: { children: ReactNode }) {
  const model = useCustomizationFeature();
  return createElement(CustomizationContext.Provider, { value: model }, children);
}

export function CustomizationPage() {
  const model = useCustomizationModel();
  return createElement(CustomizationPresentation, { model });
}

// Standalone compatibility for existing consumers and stories.
export function Customization() {
  return createElement(CustomizationProvider, { children: createElement(CustomizationPage) });
}
