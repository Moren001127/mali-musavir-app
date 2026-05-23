const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const runner = read('apps/api/src/automations/automation-runner.service.ts');
const service = read('apps/api/src/automations/automations.service.ts');
const controller = read('apps/api/src/automations/automations.controller.ts');
const listPage = read('apps/web/src/app/(panel)/panel/otomasyonlar/page.tsx');
const detailPage = read('apps/web/src/app/(panel)/panel/otomasyonlar/[id]/page.tsx');
const newPage = read('apps/web/src/app/(panel)/panel/otomasyonlar/yeni/page.tsx');

assert(
  controller.includes("@UseGuards(AuthGuard('jwt'), RolesGuard)"),
  'AutomationsController must use RolesGuard in addition to JWT auth.',
);
assert(
  (controller.match(/@Roles\('ADMIN', 'STAFF'\)/g) || []).length >= 8,
  'Automation write/run endpoints must be restricted to ADMIN/STAFF.',
);
assert(
  runner.includes('async enqueueAutomation(') &&
    runner.includes('setImmediate(() =>') &&
    controller.includes('this.runner.enqueueAutomation'),
  'Manual run and dry-run must enqueue background work instead of blocking HTTP.',
);
assert(
  runner.includes('automation.status !== AutomationStatus.ACTIVE') &&
    (runner.includes('Gerçek çalışma için önce ACTIVE') ||
      runner.includes('gerçek çalışma için önce ACTIVE')),
  'Live automation runs must require ACTIVE status.',
);
assert(
  runner.includes("_mode: 'dry-run'") &&
    runner.includes("options?.updateMetrics !== false && options?.dryRun !== true"),
  'Dry-run executions must be marked and excluded from live counters.',
);
assert(
  service.includes("AUTOMATIONS_ENABLE_WEBHOOKS !== 'true'") &&
    service.includes('DISABLED_ACTIONS') &&
    service.includes("'ocr_pdf'") &&
    service.includes("'post_to_luca'") &&
    service.includes("'send_sms'"),
  'Unsupported webhook/stub actions must be blocked before activation.',
);
assert(
  newPage.includes('estimatedCostPerRun: parsed.estimatedCostPerRun'),
  'Frontend create payload must persist parser estimatedCostPerRun.',
);
assert(
  listPage.includes("auto.status === 'ACTIVE' &&") &&
    detailPage.includes("auto.status === 'ACTIVE' &&"),
  'UI must only expose live run buttons for ACTIVE automations.',
);

console.log('automations safety regression checks passed');
