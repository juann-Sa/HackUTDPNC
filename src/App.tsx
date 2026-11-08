import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { reducers, tables } from './module_bindings';
import './App.css';

const money = (cents: number | null | undefined) =>
  cents == null
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(cents / 100);

function App() {
  const { isActive } = useSpacetimeDB();
  const [customers, customersReady] = useTable(tables.customer);
  const [customerId, setCustomerId] = useState('');
  const [status, setStatus] = useState('');
  const generateProjection = useReducer(reducers.generate180DayProjection);
  const [projectionRows, projectionReady] = useTable(
    tables.financialProjection.where(row => row.customerId.eq(customerId))
  );
  const projections = useMemo(
    () =>
      [...projectionRows].sort((a, b) =>
        a.month === b.month
          ? a.recordType.localeCompare(b.recordType)
          : a.month.localeCompare(b.month)
      ),
    [projectionRows]
  );

  const submitProjection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const requestedCustomerId = customerId.trim();
    if (!requestedCustomerId) {
      setStatus('Enter a customer ID to generate a projection.');
      return;
    }

    setStatus('Generating six-month projection…');
    try {
      await generateProjection({ customerId: requestedCustomerId });
      setStatus('Projection generated. Results are available below.');
    } catch (error) {
      console.error('Unable to generate projection:', error);
      setStatus(
        error instanceof Error
          ? `Unable to generate projection: ${error.message}`
          : 'Unable to generate projection.'
      );
    }
  };

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Spacetime 360</p>
          <h1>Financial projection</h1>
          <p>Review historical balances and generate a six-month outlook.</p>
        </div>
        <span className={`connection ${isActive ? 'connected' : ''}`}>
          {isActive ? 'Connected' : 'Connecting…'}
        </span>
      </header>

      <section className="projection-panel">
        <form className="customer-form" onSubmit={submitProjection}>
          <label htmlFor="customer-id">Customer ID</label>
          <input
            id="customer-id"
            list="customer-ids"
            value={customerId}
            onChange={event => setCustomerId(event.target.value)}
            placeholder={customersReady ? 'Choose or enter a customer ID' : 'Loading customers…'}
          />
          <datalist id="customer-ids">
            {customers.map(customer => (
              <option key={customer.customerId} value={customer.customerId} />
            ))}
          </datalist>
          <button type="submit" disabled={!isActive || !customerId.trim()}>
            Generate projection
          </button>
        </form>

        {status && <p className="status" role="status">{status}</p>}

        <div className="projection-heading">
          <h2>Projection data</h2>
          <span>
            {!projectionReady
              ? 'Loading…'
              : `${projections.length} ${projections.length === 1 ? 'row' : 'rows'}`}
          </span>
        </div>
        {projections.length === 0 ? (
          <p className="empty-state">
            {customerId
              ? 'No projection data yet. Generate a projection to populate this table.'
              : 'Enter a customer ID to view projection data.'}
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Type</th>
                  <th>Liquid balance</th>
                  <th>Debt balance</th>
                  <th>Income</th>
                  <th>Expenses</th>
                  <th>Debt payments</th>
                  <th>Holiday spike</th>
                </tr>
              </thead>
              <tbody>
                {projections.map(row => (
                  <tr key={row.projectionId}>
                    <td>{row.month}</td>
                    <td>{row.recordType}</td>
                    <td>{money(row.liquidBalanceCents)}</td>
                    <td>{money(row.debtBalanceCents)}</td>
                    <td>{money(row.monthlyIncomeCents)}</td>
                    <td>{money(row.monthlyExpensesCents)}</td>
                    <td>{money(row.monthlyDebtPaymentsCents)}</td>
                    <td>{row.holidayExpenseSpike ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
