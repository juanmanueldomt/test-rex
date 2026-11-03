// @vitest-environment jsdom
import type { StepResult, TestStep } from '@testrex/contracts';
import { expectAccessible } from '@testrex/ui/testing';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import '../lib/i18n';
import { StepsEditor, StepsView } from './steps';

const STEPS: TestStep[] = [
  { id: 's1', action: 'goto', value: '/cart' },
  {
    id: 's2',
    action: 'fill',
    target: { strategy: 'label', value: 'Coupon' },
    value: 'SAVE10',
    expected: 'The coupon is accepted',
  },
  { id: 's3', action: 'expectText', target: { strategy: 'testId', value: 'total' }, value: '90' },
];

describe('StepsView', () => {
  it('shows assertions and expected results with emphasis', async () => {
    render(<StepsView steps={STEPS} label="Steps of CHK-TC-1" />);
    const items = within(screen.getByRole('list', { name: 'Steps of CHK-TC-1' })).getAllByRole(
      'listitem',
    );
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Step 1: Go to /cart');
    expect(within(items[0]!).queryByText('Expected result')).toBeNull();
    // A written expected result is shown on its step.
    expect(items[1]).toHaveTextContent('Expected: The coupon is accepted');
    // An assertion is an expected result in itself.
    expect(within(items[2]!).getByText('Expected result')).toBeInTheDocument();
    expect(items[2]).toHaveTextContent('test id “total” contains “90”');
    await expectAccessible();
  });

  it('shows each step result and the error of the failing step', () => {
    const results: StepResult[] = [
      { stepId: 's1', status: 'passed', durationMs: 120 },
      { stepId: 's2', status: 'passed', durationMs: 30 },
      {
        stepId: 's3',
        status: 'failed',
        durationMs: 5000,
        error: 'Expected test id "total" to contain "90", but it was "100".',
      },
    ];
    render(<StepsView steps={STEPS} results={results} />);
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]!).getByText('Passed')).toBeInTheDocument();
    expect(within(items[2]!).getByText('Failed')).toBeInTheDocument();
    expect(items[2]).toHaveTextContent('but it was "100"');
  });
});

function Editor({ initial, allowManual }: { initial: TestStep[]; allowManual: boolean }) {
  const [steps, setSteps] = useState(initial);
  return (
    <>
      <StepsEditor steps={steps} onChange={setSteps} allowManual={allowManual} label="Steps" />
      <output data-testid="steps">{JSON.stringify(steps.map((step) => step.action))}</output>
    </>
  );
}

const actions = () => JSON.parse(screen.getByTestId('steps').textContent!) as string[];

describe('StepsEditor', () => {
  it('adds automated steps and turns a step into an assertion', async () => {
    const user = userEvent.setup();
    render(<Editor initial={[]} allowManual={false} />);
    expect(screen.getByText(/No steps yet/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add navigation' }));
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    expect(actions()).toEqual(['goto', 'click']);

    const second = screen.getByRole('listitem', { name: 'Step 2' });
    const action = within(second).getByLabelText('Action');
    // Automated test cases cannot hold manual steps.
    expect(within(action).queryByRole('option', { name: 'Manual step' })).toBeNull();
    await user.selectOptions(action, 'expectText');
    expect(actions()).toEqual(['goto', 'expectText']);
    expect(within(second).getByLabelText('Expected text')).toBeInTheDocument();

    await user.click(within(second).getByRole('button', { name: 'Move step 2 up' }));
    expect(actions()).toEqual(['expectText', 'goto']);
    await expectAccessible();
  });

  it('adds manual steps with an instruction and an expected result', async () => {
    const user = userEvent.setup();
    render(<Editor initial={[]} allowManual />);
    expect(screen.queryByRole('button', { name: 'Add navigation' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    expect(actions()).toEqual(['manual']);
    const step = screen.getByRole('listitem', { name: 'Step 1' });
    expect(within(step).getByLabelText('Instruction')).toBeInTheDocument();
    expect(within(step).getByLabelText('Expected result')).toBeInTheDocument();
  });
});
