import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Button,
  InputField,
  LabeledField,
  SectionHeader,
  SelectField,
} from './FormControls';

describe('FormControls', () => {
  it('renders a labeled field with hint and child control', () => {
    render(
      <LabeledField label="Endpoint" hint="Used by the provider">
        <input aria-label="Endpoint" />
      </LabeledField>,
    );
    expect(screen.getByText('Endpoint')).toBeInTheDocument();
    expect(screen.getByText('Used by the provider')).toBeInTheDocument();
    expect(screen.getByLabelText('Endpoint')).toBeInTheDocument();
  });

  it('maps input changes to string values', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<InputField ariaLabel="Model" value="" onChange={onChange} />);
    await user.type(screen.getByLabelText('Model'), 'gpt');
    expect(onChange).toHaveBeenLastCalledWith('t');
  });

  it('maps select changes to string values', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SelectField ariaLabel="Provider" value="mock" onChange={onChange}>
        <option value="mock">Mock</option>
        <option value="openai">OpenAI</option>
      </SelectField>,
    );
    await user.selectOptions(screen.getByLabelText('Provider'), 'openai');
    expect(onChange).toHaveBeenCalledWith('openai');
  });

  it('renders button variants and section headers', () => {
    render(
      <>
        <Button variant="primary">Save</Button>
        <Button variant="danger">Reset</Button>
        <SectionHeader>Advanced</SectionHeader>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('lg-btn-primary');
    expect(screen.getByRole('button', { name: 'Reset' })).toHaveClass('lg-btn-danger');
    expect(screen.getByText('Advanced')).toHaveClass('lg-form-section-header');
  });
});
