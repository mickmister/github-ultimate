import { Checkbox } from '@ark-ui/react/checkbox';

export function ReviewCheckbox({ label, checked, disabled, descriptionId, onChange }: {
  label: string; checked: boolean; disabled?: boolean; descriptionId?: string; onChange(checked: boolean): void;
}) {
  return <Checkbox.Root className="review-checkbox" checked={checked} disabled={disabled} onCheckedChange={details => onChange(details.checked === true)}>
    <Checkbox.HiddenInput aria-describedby={descriptionId} />
    <Checkbox.Control><Checkbox.Indicator>✓</Checkbox.Indicator></Checkbox.Control>
    <Checkbox.Label>{label}</Checkbox.Label>
  </Checkbox.Root>;
}
