import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GameSelect } from './GameSelect';

const options = [
  { value: 'one', label: 'Um' },
  { value: 'locked', label: 'Bloqueado', disabled: true },
  { value: 'two', label: 'Dois' },
];

describe('custom game select', () => {
  it('opens a local listbox and changes the selected value by touch', () => {
    const onChange = vi.fn();
    render(
      <GameSelect
        id="activity"
        label="Atividade"
        value="one"
        options={options}
        onChange={onChange}
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'Atividade: Um' });
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox', { name: 'Atividade' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Um' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Dois' }));
    expect(screen.getByRole('option', { name: 'Dois' })).toHaveClass('active');
    fireEvent.click(screen.getByRole('option', { name: 'Dois' }));
    expect(onChange).toHaveBeenCalledWith('two');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('supports arrow, home, end, enter, and escape keyboard controls', () => {
    const onChange = vi.fn();
    render(
      <GameSelect
        id="activity"
        label="Atividade"
        value="one"
        options={options}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Atividade: Um' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(trigger).toHaveAttribute('aria-activedescendant', 'activity-option-2');
    fireEvent.keyDown(trigger, { key: 'Home' });
    expect(trigger).toHaveAttribute('aria-activedescendant', 'activity-option-0');
    fireEvent.keyDown(trigger, { key: 'End' });
    expect(trigger).toHaveAttribute('aria-activedescendant', 'activity-option-2');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('two');

    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    fireEvent.keyDown(trigger, { key: ' ' });
    expect(onChange).toHaveBeenLastCalledWith('one');
  });

  it('closes on outside pointer input and leaves locked options unavailable', () => {
    const onChange = vi.fn();
    render(
      <>
        <GameSelect
          id="activity"
          label="Atividade"
          value="one"
          options={options}
          onChange={onChange}
        />
        <button type="button">Fora</button>
      </>,
    );
    const trigger = screen.getByRole('combobox', { name: 'Atividade: Um' });
    fireEvent.click(trigger);
    expect(screen.getByRole('option', { name: 'Bloqueado' })).toBeDisabled();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Fora' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes when toggled or when pointer input stays inside the custom control', () => {
    const onChange = vi.fn();
    render(
      <GameSelect
        id="activity"
        label="Atividade"
        value="one"
        options={options}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Atividade: Um' });
    fireEvent.click(trigger);
    fireEvent.pointerDown(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('handles empty lists and lists where every option is disabled', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <GameSelect id="empty" label="Vazio" value="none" options={[]} onChange={onChange} />,
    );
    const emptyTrigger = screen.getByRole('combobox', { name: 'Vazio: Escolha uma opção' });
    fireEvent.keyDown(emptyTrigger, { key: 'ArrowDown' });
    expect(emptyTrigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(emptyTrigger, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();

    rerender(
      <GameSelect
        id="disabled"
        label="Indisponível"
        value="locked"
        options={[{ value: 'locked', label: 'Indisponível', disabled: true }]}
        onChange={onChange}
      />,
    );
    const disabledTrigger = screen.getByRole('combobox', {
      name: 'Indisponível: Indisponível',
    });
    fireEvent.keyDown(disabledTrigger, { key: 'ArrowDown' });
    fireEvent.keyDown(disabledTrigger, { key: 'ArrowDown' });
    expect(disabledTrigger).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(disabledTrigger, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
