import { expect, test } from '@playwright/test';
import { createScenarioViaApi, ownerWithApp, updateScenarioViaApi } from './helpers';

test('Spanish interface: tabs, columns, filters, buttons, empty states and relative times', async ({
  page,
}) => {
  const { slug, app } = await ownerWithApp(page.request);
  await page.goto(`${app}/scenarios`);
  await expect(page.getByText('No test scenarios yet')).toBeVisible();

  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Español' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');

  // Empty state and tabs.
  await expect(page.getByText('Todavía no hay escenarios de prueba')).toBeVisible();
  const tabs = page.getByRole('navigation', { name: 'Secciones de la aplicación' });
  await expect(tabs.getByRole('link', { name: /Escenarios de prueba/ })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Ejecuciones' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Nuevo escenario' }).first()).toBeVisible();

  // Grid with data: column headers, filters, statuses and relative times.
  await createScenarioViaApi(page.request, slug, 'CHK', {
    title: 'Pago con cupón',
    tags: ['smoke'],
  });
  await updateScenarioViaApi(page.request, slug, 'CHK', 'CHK-TS-1', {
    baseRevision: 1,
    status: 'ready',
  });
  await page.reload();
  const grid = page.getByRole('grid', { name: 'Escenarios de prueba' });
  await expect(grid.getByRole('columnheader')).toHaveText([
    'Clave',
    'Título',
    'Estado',
    'Módulo',
    'Prioridad',
    'Etiquetas',
    'Casos de prueba',
    'Autor',
    'Actualizado',
  ]);
  const row = grid.getByRole('row').nth(1);
  await expect(row).toContainText('Listo');
  await expect(row).toContainText('Media');
  await expect(row.locator('time')).toHaveText(/minuto|segundo|ahora|hace/);
  const filters = page.getByRole('group', { name: 'Filtros' });
  for (const name of ['Estado', 'Módulo', 'Prioridad', 'Autor', 'Versión', 'Mostrar eliminados']) {
    await expect(filters.getByRole('button', { name })).toBeVisible();
  }
  await page.getByRole('searchbox', { name: 'Buscar escenarios' }).fill('nada-coincide');
  await expect(page.getByText('Ningún escenario coincide')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quitar filtros' })).toBeVisible();

  // Scenario page, in Spanish too; user content is not translated.
  await page.goto(`${app}/scenarios/CHK-TS-1`);
  await expect(page.getByRole('heading', { name: 'Pago con cupón' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Detalles' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Casos de prueba (0)' })).toBeVisible();
  await page.getByRole('tab', { name: 'Historial' }).click();
  await expect(page.getByText('Estado: Borrador → Listo')).toBeVisible();
  await expect(page.getByText('Creó el escenario')).toBeVisible();

  await page.goto(`${app}/runs`);
  await expect(page.getByText('Las ejecuciones están en construcción')).toBeVisible();
});
