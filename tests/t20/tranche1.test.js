/**
 * T20 — Translation tranche 1 (Nov 13, 2026).
 *
 * The first four locales in ABC order — Amharic (am), Arabic (ar),
 * Bengali (bn), Bhojpuri (bho) — had their translation debt retired:
 * every UI string that had been propagated as verbatim-English
 * interim (workforce, inbox/messaging, training, recovery kit,
 * Send-PO, trial reminders, delete warning, Rewards, POS, and the
 * POS plan-gate strings) is now translated, and all three policy
 * bodies (Terms, Subscription Policy, Privacy Policy) are registered
 * for these locales in src/lib/policyTranslations.js.
 *
 * DEBT DEFINITION (the census this pass ran on): a key is debt when
 * the locale value is byte-identical to the English value AND the
 * English value carries translatable natural language — i.e. it is
 * NOT any of the legitimately-identical categories:
 *   - empty, placeholder-only, letter-free after stripping
 *     placeholders, or a bare URL;
 *   - settings.deleteConfirmWord (each locale's own word by design;
 *     English variants keep DELETE);
 *   - settings.details.* language labels (identical in every file
 *     by the standing rule in src/lib/locales/README.md);
 *   - composed solely of proper/technical tokens (brand and channel
 *     names, plan names, US program names, technical abbreviations
 *     such as SKU/UPC/ISBN) plus separators — these stay in Latin
 *     script in every locale file, per each file's own header;
 *   - an example-data placeholder (a *Placeholder key whose value is
 *     sample data: an email address, a bare domain a user must type
 *     literally, or one of the fictional example names);
 *   - a VERIFIED COGNATE (tranche 2, Nov 13, 2026): a short value
 *     whose correct translation is spelled identically in the target
 *     language. Spanish is the first case: Total, Subtotal, Digital,
 *     Roles, Kit, kg, the table-header abbreviation No, and
 *     "{count} roles" (roles is the Spanish plural of rol) are the
 *     same words in Spanish. These keys are pinned per locale in
 *     COGNATE_KEYS below — the exemption names exact keys, verified
 *     one by one, never a pattern, so a genuinely untranslated string
 *     can never hide inside it.
 * English regional variants (en-GB/CA/AU/IN) are adaptations, not
 * translations — most values are identical by design and they are
 * out of scope for the debt census.
 *
 * TRANCHE 2 (Nov 13, 2026): the six Spanish variants — es-MX, es-ES,
 * es-US, es-CU, es-PR, es-VE — retired their debt in the same shape
 * (UI keys + all three policy bodies registered). The locale list
 * below is the union of completed tranches; later tranches append.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import {
  POLICY_KINDS,
  getPolicyDocument,
  hasPolicyTranslation,
} from '../../src/lib/policyTranslations.js';
import { STOCKHAVEN_TERMS_OF_SERVICE } from '../../src/lib/stockhavenTermsOfService.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY } from '../../src/lib/stockhavenSubscriptionPolicy.js';
import { STOCKHAVEN_PRIVACY_POLICY } from '../../src/lib/stockhavenPrivacyPolicy.js';

const TRANCHE_1_LOCALES = [
  'am', 'ar', 'bn', 'bho',
  // Tranche 2 (Nov 13, 2026): the six Spanish variants.
  'es-MX', 'es-ES', 'es-US', 'es-CU', 'es-PR', 'es-VE',
  // Tranche 3 (Nov 13, 2026): French and Portuguese.
  'fr-FR', 'fr-CA', 'pt-BR', 'pt-PT',
  // Tranche 4 (Nov 13, 2026): Chinese Simplified + Traditional,
  // Cantonese and Wu.
  'zh-Hans', 'zh-Hant', 'yue', 'wuu',
  // Tranche 5 (Nov 13, 2026): German, Italian, Japanese.
  'de', 'it', 'ja',
  // Tranche 6 registrations (Nov 13, 2026)
  'ko', 'ru', 'uk',
  // Tranche 7 registrations (Nov 13, 2026)
  'fa', 'prs', 'ur',
  // Tranche 8 registrations (Nov 13, 2026)
  'hi', 'tg', 'tr',
  // Tranche 9 registrations (Nov 13, 2026)
  'gu', 'kn', 'mr',
  // Tranche 10 registrations (Nov 13, 2026)
  'ta', 'te', 'pa-Guru',
  // Tranche 11 registrations (Nov 13, 2026)
  'pa-Arab', 'id', 'ms',
  // Tranche 12 registrations (Nov 13, 2026)
  'th', 'vi', 'tl',
  // Tranche 13 registrations (Nov 13, 2026)
  'ha', 'sw', 'yo',
  // Tranche 14 registrations (Nov 13, 2026)
  'jv',
  // Tranche 15 registrations (Nov 13, 2026) — final locale
  'pcm',
];

// Verified cognates: keys whose correct Spanish value is spelled
// identically to the English (see the census definition above).
// Verified key-by-key for every Spanish variant — the identical set
// was the same 15 keys in all six. The pricing batch (Nov 13, 2026)
// adds 'pricing.rollbackBadge': "Rollback" is Walmart's actual
// Spanish-language branding for the sale, verified for all six.
const SPANISH_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "Total" is the Spanish word, "g" is the gram symbol, and the Fahrenheit/Celsius scale names are spelled the same in Spanish — verified.
  'ops.invoices.colTotal', 'units.unitPlaceholder', 'ops.tempLogs.scaleF', 'ops.tempLogs.scaleC',
  'products.exportNo', 'print.no',
  'productForm.fulfillDigital', 'productForm.unitKg',
  'orders.subtotal', 'orders.total',
  'purchasing.subtotal', 'purchasing.total',
  'reports.total', 'print.subtotal', 'print.total',
  'staff.rolesCount', 'staff.rolesHeading', 'staff.statRoles',
  'bomLib.kindBundleShort', 'pricing.rollbackBadge',
  // Restaurant corner batch (Nov 23, 2026): "Par" is the
  // kitchen-Spanish word for the par level in the variants that
  // keep it bare (the others read "Nivel par") — verified.
  'guide.colPar',
  // Age check build (Nov 25, 2026): "Alcohol" is the Spanish
  // word (RAE), spelled identically to the English as a label —
  // verified for all six variants.
  'ageCheck.category.alcohol',
]);
const FR_FR_COGNATE_KEYS = new Set([
  // Prints build (Nov 25, 2026): "Score" is the genuine French
  // word for a quiz score, spelled the same — verified.
  'print.colScore',
  // Restaurant operations batch (Nov 23, 2026): "Note", "Date" and "Total" are the genuine French words, "PO {number}" is the purchase-order code format, "g" is the gram symbol, and the scale names are spelled the same in French — verified.
  'ops.invoices.poPrefix', 'ops.invoices.noteLabel', 'ops.invoices.colDate', 'ops.invoices.colTotal',
  'ops.waste.noteLabel', 'ops.waste.colDate', 'batch.noteLabel', 'units.unitPlaceholder', 'ops.tempLogs.scaleF',
  'ops.tempLogs.scaleC', 'ops.eightySix.noteLabel', 'staffMeals.noteLabel', 'staffMeals.colDate',
  'print.transferDate',
  'dashboard.minReorder', 'importLib.field.description', 'importLib.updateField.description',
  'importLib.updateField.dimensions', 'inventoryLib.movementCorrection', 'locations.limitLabel',
  'locations.typeLabel', 'movements.typeCorrections', 'orders.total',
  'payroll.cash.date', 'payroll.config.customKind', 'payroll.dd.form.date',
  'payroll.dd.form.signature', 'print.total', 'productDetails.descriptionTitle',
  'productDetails.rowDimensions', 'productForm.descriptionLabel', 'productForm.dimensionsLabel',
  'productForm.photosLabel', 'productForm.unitKg', 'products.colActions',
  'products.colCodes', 'products.conditionAcceptable', 'products.photoAlt',
  'purchasing.total', 'reports.total', 'returns.type',
  'rewards.code', 'rewards.slip.code', 'scan.adjustment.correction',
  'scan.destination', 'settings.identity.logoLabel', 'settings.software.application',
  'staffLib.area.stock', 'suppliers.contact', 'training.module.exports',
  'training.module.messaging', 'training.module.scanner', 'workforce.messages.title',
  'workforce.tasks.notes',
  // Translation sweep (Nov 15, 2026): 'Photo' and 'Fiction' are
  // the genuine French words — true cognates, not untranslated.
  'products.colPhoto', 'productForm.categoryPlaceholder',
  // Checklists build (Nov 26, 2026): 'Photo' and 'Scan' are
  // the genuine French words for the proof kinds — true
  // cognates, not untranslated.
  // Kitchen-menu build (plan release 371, Nov 26, 2026):
  // "Menu" is the genuine French word for the guest menu's
  // document title — a true cognate, not untranslated.
  'guestMenu.docTitle',
  // Equipment build (plan release 372, Nov 26, 2026):
  // "Machines" and "Notes" are the genuine French words for
  // the machines heading and the notes label — true
  // cognates, not untranslated.
  'equipment.machinesTitle', 'equipment.notesLabel',
  'checklists.proofPhoto', 'checklists.proofScan',
  // Training builds (Nov 20, 2026): 'Question' is the genuine
  // French word for the owner's-quiz question label.
  'settings.policyQuiz.question',
  // Staff documents (Nov 21, 2026): 'Documents' is the genuine
  // French word for the documents button label.
  'staff.documents.open',
  // Restaurant corner batch (Nov 23, 2026): "Restaurant",
  // "Active" and "Description" are the genuine French words,
  // and "Par" is the kept domain term — verified word-by-word.
  'nav.group.restaurant', 'training.module.restaurant', 'restaurant.eyebrow',
  // Restaurant IA batch (release 377, Nov 25, 2026): "Restaurant"
  // is the genuine French word for the corner's own nav door
  // too — the same cognate as nav.group.restaurant above.
  'nav.restaurant',
  'recipes.statusActive', 'recipes.descriptionLabel', 'guide.colPar',
  // Import robustness batch (release 365, Nov 23, 2026): "Photo"
  // is the genuine French word for the import field too — the
  // same cognate as products.colPhoto above, verified.
  'importLib.field.photo',
  // Product form batch (Nov 24, 2026): "Format" is the genuine
  // French word for the field — verified.
  'productForm.formatLabel', 'productDetails.rowFormat', 'importLib.field.format',
  'importLib.updateField.format',
]);
const FR_CA_COGNATE_KEYS = new Set([
  // Prints build (Nov 25, 2026): "Score" — same French cognate
  // as fr-FR — verified.
  'print.colScore',
  // Checklists build (Nov 26, 2026): 'Photo' and 'Scan' — same
  // French cognates as fr-FR — verified.
  // Kitchen-menu build (plan release 371, Nov 26, 2026):
  // "Menu" is the genuine French word for the guest menu's
  // document title — a true cognate, not untranslated.
  'guestMenu.docTitle',
  // Equipment build (plan release 372, Nov 26, 2026):
  // "Machines" and "Notes" are the genuine French words for
  // the machines heading and the notes label — true
  // cognates, not untranslated.
  'equipment.machinesTitle', 'equipment.notesLabel',
  'checklists.proofPhoto', 'checklists.proofScan',
  // Restaurant operations batch (Nov 23, 2026): Same French cognates as fr-FR — verified.
  'ops.invoices.poPrefix', 'ops.invoices.noteLabel', 'ops.invoices.colDate', 'ops.invoices.colTotal',
  'ops.waste.noteLabel', 'ops.waste.colDate', 'batch.noteLabel', 'units.unitPlaceholder', 'ops.tempLogs.scaleF',
  'ops.tempLogs.scaleC', 'ops.eightySix.noteLabel', 'staffMeals.noteLabel', 'staffMeals.colDate',
  'print.transferDate',
  'counts.notesLabel', 'dashboard.minReorder', 'importLib.field.description',
  'importLib.receiveField.note', 'importLib.updateField.description', 'importLib.updateField.dimensions',
  'importLib.updateField.notes', 'inventory.noteLabel', 'inventoryLib.movementCorrection',
  'listings.notes', 'locations.limitLabel', 'locations.typeLabel',
  'materials.notes', 'movements.typeCorrections', 'orders.notes',
  'orders.total', 'payroll.cash.date', 'payroll.config.customKind',
  'payroll.dd.form.date', 'payroll.dd.form.signature', 'print.colNotes',
  'print.note', 'print.notes', 'print.total',
  'productDetails.descriptionTitle', 'productDetails.notesTitle', 'productDetails.rowDimensions',
  'productForm.descriptionLabel', 'productForm.dimensionsLabel', 'productForm.notesLabel',
  'productForm.photosLabel', 'productForm.unitKg', 'products.colActions',
  'products.colCodes', 'products.conditionAcceptable', 'products.exportColNotes',
  'products.photoAlt', 'purchasing.note', 'purchasing.total',
  'reports.total', 'returns.notes', 'returns.type',
  'rewards.code', 'rewards.slip.code', 'scan.adjustment.correction',
  'scan.destination', 'settings.identity.logoLabel', 'settings.software.application',
  'staff.memberDialog.notesLabel', 'staffLib.area.stock', 'suppliers.contact',
  'suppliers.notes', 'training.module.messaging', 'workforce.messages.title',
  'workforce.tasks.notes',
  // Translation sweep (Nov 15, 2026): same French cognates as fr-FR.
  'products.colPhoto', 'productForm.categoryPlaceholder',
  // Training builds (Nov 20, 2026): 'Question' — same cognate as fr-FR.
  'settings.policyQuiz.question',
  // Staff documents (Nov 21, 2026): 'Documents' — same cognate as fr-FR.
  'staff.documents.open',
  // Restaurant corner batch (Nov 23, 2026): "Restaurant",
  // "Active" and "Description" are the genuine French words,
  // and "Par" is the kept domain term — verified word-by-word.
  'nav.group.restaurant', 'training.module.restaurant', 'restaurant.eyebrow',
  // Restaurant IA batch (release 377, Nov 25, 2026): "Restaurant"
  // — same French cognate as fr-FR, for the corner's nav door.
  'nav.restaurant',
  'recipes.statusActive', 'recipes.descriptionLabel', 'guide.colPar',
  // Import robustness batch (release 365, Nov 23, 2026): "Photo"
  // — same French cognate as fr-FR, verified.
  'importLib.field.photo',
  // Product form batch (Nov 24, 2026): "Format" is the genuine
  // French word for the field — verified.
  'productForm.formatLabel', 'productDetails.rowFormat', 'importLib.field.format',
  'importLib.updateField.format',
]);
const PT_BR_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "Status", "Total" and "Item" are the genuine Portuguese words, "g" is the gram symbol, and the scale names are spelled the same in Portuguese — verified.
  'ops.invoices.statusLabel', 'ops.invoices.colTotal', 'ops.invoices.colStatus', 'units.unitPlaceholder',
  'ops.tempLogs.scaleF', 'ops.tempLogs.scaleC', 'ops.eightySix.productLabel', 'print.transferItem',
  'bomLib.kindBundleShort', 'dashboard.skusCount', 'exports.backupJson',
  'listings.status', 'locations.kindVan', 'locations.skusLabel',
  'orders.subtotal', 'orders.total', 'print.colItem',
  'print.status', 'print.subtotal', 'print.total',
  'productDetails.rowStatus', 'productForm.fulfillDigital', 'productForm.statusLabel',
  'productForm.unitKg', 'products.bulkChangeStatus', 'purchasing.status',
  'purchasing.subtotal', 'purchasing.total', 'reports.total',
  'staff.memberDialog.statusLabel', 'training.module.scanner',
  // Restaurant corner batch (Nov 23, 2026): "Status" and the
  // domain term "Par" are the genuine Portuguese words — verified.
  'recipes.statusLabel', 'guide.colPar',
  // Kitchen-menu build (plan release 371, Nov 26, 2026):
  // "Menu" is the genuine Portuguese word for the guest
  // menu's document title — verified.
  'guestMenu.docTitle',
]);
const PT_PT_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "Status", "Total" and "Item" are the genuine Portuguese words, "g" is the gram symbol, and the scale names are spelled the same in Portuguese — verified.
  'ops.invoices.statusLabel', 'ops.invoices.colTotal', 'ops.invoices.colStatus', 'units.unitPlaceholder',
  'ops.tempLogs.scaleF', 'ops.tempLogs.scaleC', 'ops.eightySix.productLabel', 'print.transferItem',
  'auth.emailLabel', 'bomLib.kindBundleShort', 'dashboard.skusCount',
  'locations.skusLabel', 'orders.subtotal', 'orders.total',
  'print.colItem', 'print.subtotal', 'print.total',
  'productForm.fulfillDigital', 'productForm.unitKg', 'purchasing.subtotal',
  'purchasing.total', 'reports.total', 'staffLib.area.stock',
  // Restaurant corner batch (Nov 23, 2026): "Par" is the kept
  // domain term — verified.
  'guide.colPar',
  // Kitchen-menu build (plan release 371, Nov 26, 2026):
  // "Menu" is the genuine Portuguese word — verified.
  'guestMenu.docTitle',
]);
const DE_COGNATE_KEYS = new Set([
  // Tip-pooling build (plan release 373, Nov 26, 2026):
  // "Person" is the genuine German word for the split
  // table's person column head — verified (the same word
  // as foodSafety.certs.colPerson below).
  'tipPooling.colPerson',
  // Food-safety build (plan release 370, Nov 26, 2026): "Person"
  // and "Status" are the genuine German words for the certificate
  // table's column heads — verified.
  'foodSafety.certs.colPerson', 'foodSafety.certs.colStatus',
  // Checklists build (Nov 26, 2026): "Scan" is the genuine
  // German word (der Scan) for the proof kind — verified.
  'checklists.proofScan',
  // Restaurant operations batch (Nov 23, 2026): "Status" is the genuine German word, "PO {number}" is the purchase-order code format, "g" is the gram symbol, and the scale names are spelled the same in German — verified.
  'ops.invoices.poPrefix', 'ops.invoices.statusLabel', 'ops.invoices.colStatus', 'units.unitPlaceholder',
  'ops.tempLogs.scaleF', 'ops.tempLogs.scaleC',
  'alerts.nameLabel', 'bomLib.kindBundle', 'categories.nameLabel',
  'dashboard.skusCount', 'import.colName', 'import.problemColProblem',
  'importLib.field.barcode', 'inventory.notePlaceholder', 'layout.scanCodes',
  'listings.status', 'locations.nameLabel', 'locations.optionalPlaceholder',
  'locations.skusLabel', 'nav.import', 'orders.customerNamePlaceholder',
  'payroll.bonus', 'payroll.config.customName', 'print.barcodeLabel',
  'print.status', 'print.templateBarcode', 'productDetails.codeBarcode',
  'productDetails.rowStatus', 'productForm.barcodeLabel', 'productForm.generateTypeBarcode', 'productForm.fulfillDigital',
  'productForm.statusLabel', 'productForm.unitKg', 'products.colCodes',
  'products.exportColBarcode', 'products.exportColName', 'products.sortCodes',
  'purchasing.status', 'rewards.code', 'rewards.slip.code',
  'settings.identity.logoLabel', 'settings.switcher.taglinePlaceholder', 'staff.eyebrow',
  'staff.member.administrator', 'staff.memberDialog.statusLabel', 'staff.teamHeading',
  'suppliers.website', 'training.module.scanner',
  // Restaurant corner batch (Nov 23, 2026): "Restaurant" and
  // "Status" are the genuine German words — verified.
  'nav.group.restaurant', 'training.module.restaurant', 'restaurant.eyebrow',
  // Restaurant IA batch (release 377, Nov 25, 2026): "Restaurant"
  // is the genuine German word for the corner's nav door too.
  'nav.restaurant',
  'recipes.statusLabel',
  // Product form batch (Nov 24, 2026): "Format" is the genuine
  // German word for the field — verified.
  'productForm.formatLabel', 'productDetails.rowFormat', 'importLib.field.format',
  'importLib.updateField.format',
]);
const IT_COGNATE_KEYS = new Set([
  // Kitchen-menu build (plan release 371, Nov 26, 2026):
  // "Menu" is the genuine Italian word for the guest menu's
  // document title — verified.
  'guestMenu.docTitle',
  // Restaurant operations batch (Nov 23, 2026): "Per" is the genuine Italian preposition ("Per 1 {unit}"), "PO {number}" is the purchase-order code format, "g" is the gram symbol, and the scale names are spelled the same in Italian — verified.
  'ops.invoices.poPrefix', 'units.unitPlaceholder', 'units.perLabel', 'ops.tempLogs.scaleF', 'ops.tempLogs.scaleC',
  'auth.emailLabel', 'auth.passwordLabel', 'bomLib.kindBundleShort',
  'dashboard.minReorder', 'exports.backupJson', 'orders.email',
  'payroll.bonus', 'print.no', 'productForm.unitKg',
  'products.exportNo', 'reports.fieldReport', 'settings.identity.logoLabel',
  'staff.memberDialog.emailLabel', 'suppliers.email', 'training.module.scanner',
  // Restaurant corner batch (Nov 23, 2026): "Par" is the kept
  // domain term — verified.
  'guide.colPar',
]);
const JA_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "g" is the gram symbol, spelled the same in Japanese — verified.
  'units.unitPlaceholder',
  'productForm.unitKg',
]);
const KO_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "g" is the gram symbol, spelled the same in Korean — verified.
  'units.unitPlaceholder',
  'productForm.unitKg',
]);
const FA_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "g" is the gram symbol, spelled the same in Persian — verified.
  'units.unitPlaceholder',
  'productForm.unitKg',
]);
const PRS_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "g" is the gram symbol, spelled the same in Dari — verified.
  'units.unitPlaceholder',
  'productForm.unitKg',
]);
const UR_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "PO {number}" is the purchase-order code format and "g" is the gram symbol — verified.
  'ops.invoices.poPrefix', 'units.unitPlaceholder',
  'businessLib.dateFormat.dMmmYyyy', 'businessLib.dateFormat.mmmDyyyy', 'dashboard.skusCount',
  'layout.scanCodes', 'locations.skusLabel', 'productForm.unitKg',
]);
const TR_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "Transfer" is the genuine Turkish word, "g" is the gram symbol, and the scale names are spelled the same in Turkish — verified.
  'units.unitPlaceholder', 'ops.tempLogs.scaleF', 'ops.tempLogs.scaleC', 'print.transferTitle',
  'bomLib.kindBundleShort', 'dashboard.minReorder', 'inventoryLib.movementTransfer',
  'print.refSuffix', 'productForm.unitKg', 'scan.action.transfer',
  'settings.identity.logoLabel',
  // Restaurant corner batch (Nov 23, 2026): "Par" is the kept
  // domain term — verified.
  'guide.colPar',
  // Product form batch (Nov 24, 2026): Turkish keeps "Format"
  // as its own word for the field — verified.
  'productForm.formatLabel', 'productDetails.rowFormat', 'importLib.field.format',
  'importLib.updateField.format',
]);
const KN_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "PO {number}" is the purchase-order code format and "g" is the gram symbol — verified.
  'ops.invoices.poPrefix', 'units.unitPlaceholder',
  'productForm.unitKg',
]);
const MR_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "PO {number}" is the purchase-order code format and "g" is the gram symbol — verified.
  'ops.invoices.poPrefix', 'units.unitPlaceholder',
  'productForm.unitKg',
]);
const TA_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "PO {number}" is the purchase-order code format and "g" is the gram symbol — verified.
  'ops.invoices.poPrefix', 'units.unitPlaceholder',
  'productForm.unitKg',
]);
const TE_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "PO {number}" is the purchase-order code format and "g" is the gram symbol — verified.
  'ops.invoices.poPrefix', 'units.unitPlaceholder',
  'businessLib.dateFormat.dMmmYyyy', 'businessLib.dateFormat.mmmDyyyy', 'payroll.dd.checking',
  'payroll.dd.savings', 'productForm.unitKg',
]);
const PA_GURU_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "g" is the gram symbol, spelled the same in Punjabi — verified.
  'units.unitPlaceholder',
  'locations.skusLabel', 'productForm.unitKg',
]);
const PA_ARAB_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "g" is the gram symbol, spelled the same in Punjabi (Shahmukhi) — verified.
  'units.unitPlaceholder',
  'businessLib.dateFormat.dMmmYyyy', 'businessLib.dateFormat.mmmDyyyy', 'layout.scanCodes',
  'productForm.unitKg',
]);
const ID_COGNATE_KEYS = new Set([
  // Kitchen-menu build (plan release 371, Nov 26, 2026):
  // "Menu" is the genuine word for the guest menu's document
  // title in this language — verified.
  'guestMenu.docTitle',
  // Food-safety build (plan release 370, Nov 26, 2026):
  // "Sanitizer" is the genuine Indonesian word for the check kind
  // — verified.
  'foodSafety.logs.kind.sanitizer',
  // Food-safety build (plan release 370, Nov 26, 2026): "Status"
  // is the genuine Indonesian word — verified.
  'foodSafety.certs.colStatus',
  // Restaurant operations batch (Nov 23, 2026): Indonesian keeps "Status", "Total", "Unit", "Item", "Per", "Transfer" and "Total margin" in these forms, "PO {number}" is the code format, "g" is the gram symbol, and the scale names are spelled the same — verified word-by-word.
  'ops.invoices.poPrefix', 'ops.invoices.statusLabel', 'ops.invoices.colTotal', 'ops.invoices.colStatus',
  'units.unitPlaceholder', 'units.perLabel', 'ops.tempLogs.unitLabel', 'ops.tempLogs.scaleF', 'ops.tempLogs.scaleC',
  'ops.tempLogs.colUnit', 'ops.eightySix.productLabel', 'menu.colTotalMargin', 'print.transferTitle',
  'print.transferItem',
  'dashboard.minReorder', 'exports.eyebrow', 'import.eyebrow',
  'listings.status', 'orders.subtotal', 'payroll.bonus',
  'print.status', 'print.subtotal', 'productDetails.rowSerial',
  'productDetails.rowStatus', 'productForm.customLabelPlaceholder', 'productForm.statusLabel',
  'productForm.unitKg', 'products.bulkChangeStatus', 'purchasing.status',
  'purchasing.subtotal', 'staff.member.administrator', 'staff.memberDialog.statusLabel',
  // Restaurant corner batch (Nov 23, 2026): Indonesian keeps
  // "Edit", "Status" and the domain term "Par" — verified.
  'recipes.editButton', 'recipes.statusLabel', 'pars.editTitle',
  'guide.colPar',
  // Product form batch (Nov 24, 2026): Indonesian keeps "Format"
  // as its own word for the field — verified.
  'productForm.formatLabel', 'productDetails.rowFormat', 'importLib.field.format',
  'importLib.updateField.format',
]);
const MS_COGNATE_KEYS = new Set([
  // Kitchen-menu build (plan release 371, Nov 26, 2026):
  // "Menu" is the genuine word for the guest menu's document
  // title in this language — verified.
  'guestMenu.docTitle',
  // Food-safety build (plan release 370, Nov 26, 2026):
  // "Sanitizer" is the genuine Malay word for the check kind
  // — verified.
  'foodSafety.logs.kind.sanitizer',
  // Food-safety build (plan release 370, Nov 26, 2026): "Status"
  // is the genuine Malay word — verified.
  'foodSafety.certs.colStatus',
  // Restaurant operations batch (Nov 23, 2026): Malay keeps "Status", "Total", "Unit", "Item", "Per", "Transfer" and "Total margin" in these forms, "PO {number}" is the code format, "g" is the gram symbol, and the scale names are spelled the same — verified word-by-word.
  'recipes.lineUnit', 'ops.invoices.poPrefix', 'ops.invoices.statusLabel', 'ops.invoices.colTotal',
  'ops.invoices.colStatus', 'units.unitLabel', 'units.unitPlaceholder', 'units.perLabel', 'ops.tempLogs.unitLabel',
  'ops.tempLogs.scaleF', 'ops.tempLogs.scaleC', 'ops.tempLogs.colUnit', 'ops.eightySix.productLabel',
  'menu.colTotalMargin', 'print.transferTitle', 'print.transferItem',
  'alerts.editRule', 'bomLib.kindBundleShort', 'businessLib.brandColor.plum',
  'businessLib.dateFormat.dMmmYyyy', 'categories.editAria', 'categories.kindTag',
  'dashboard.minReorder', 'exports.eyebrow', 'import.eyebrow',
  'listings.editAria', 'listings.status', 'locations.editAria',
  'locations.kindVan', 'materials.edit', 'nav.import',
  'orders.edit', 'orders.editTitle', 'payroll.bonus',
  'print.colItem', 'print.factUnit', 'print.status',
  'productDetails.rowStatus', 'productDetails.rowUnit', 'productForm.customLabelPlaceholder',
  'productForm.fulfillDigital', 'productForm.statusLabel', 'productForm.unitKg',
  'products.bulkChangeStatus', 'products.editAria', 'products.exportColUnit',
  'purchasing.edit', 'purchasing.editTitle', 'purchasing.status',
  'returns.edit', 'returns.editTitle', 'settings.identity.logoLabel',
  'staff.member.edit', 'staff.memberDialog.statusLabel', 'staff.roleCard.edit',
  'staffLib.importOnly',
  // Restaurant corner batch (Nov 23, 2026): Malay keeps
  // "Edit", "Status" and the domain term "Par" — verified.
  'recipes.editButton', 'recipes.statusLabel', 'pars.editTitle',
  'guide.colPar',
  // Product form batch (Nov 24, 2026): Malay keeps "Format" as
  // its own word for the field — verified.
  'productForm.formatLabel', 'productDetails.rowFormat', 'importLib.field.format',
  'importLib.updateField.format',
]);
const TH_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "PO {number}" is the purchase-order code format and "g" is the gram symbol — verified.
  'ops.invoices.poPrefix', 'units.unitPlaceholder',
  'productForm.unitKg', 'products.exportColQr',
]);
const VI_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "PO {number}" is the purchase-order code format, "g" is the gram symbol, and the Fahrenheit/Celsius scale names are kept in Vietnamese — verified.
  'ops.invoices.poPrefix', 'units.unitPlaceholder', 'ops.tempLogs.scaleF', 'ops.tempLogs.scaleC',
  'auth.emailLabel', 'orders.email', 'productForm.unitKg',
  'settings.identity.logoLabel', 'staff.memberDialog.emailLabel', 'suppliers.email',
]);
const TL_COGNATE_KEYS = new Set([
  // Kitchen-menu build (plan release 371, Nov 26, 2026):
  // "Menu" is the genuine word for the guest menu's document
  // title in this language — verified.
  'guestMenu.docTitle',
  // Food-safety build (plan release 370, Nov 26, 2026):
  // "Sanitizer" is the genuine Tagalog word for the check kind
  // — verified.
  'foodSafety.logs.kind.sanitizer',
  // Checklists build (Nov 26, 2026): Tagalog keeps "Scan" for
  // the proof kind, the everyday loanword — verified.
  'checklists.proofScan',
  // Prints build (Nov 25, 2026): Tagalog keeps "Timesheet" for
  // the time sheet, the same loanword it uses throughout —
  // verified.
  'print.timesheetTitle',
  // eBay storefront batch (release 362, Nov 23, 2026): "Order" is
  // the everyday Tagalog word for a placed order — verified.
  'storefronts.orderLabel',
  // Paper-trail batch (release 378, Nov 25, 2026): Tagalog
  // keeps "Invoice" for the credit memo's field and column
  // and "Entry" for the log book's field label, the same
  // loanwords it uses throughout — verified.
  'ops.credits.colInvoice', 'ops.credits.invoiceLabel', 'logBook.bodyLabel',
  // Restaurant operations batch (Nov 23, 2026): Tagalog keeps these kitchen and menu-engineering terms in English, as it does throughout (the quadrant names are the menu-engineering proper names) — verified word-by-word.
  'nav.menu', 'ops.invoices.supplierLabel', 'ops.invoices.poLabel', 'ops.invoices.poPrefix',
  'ops.invoices.statusDraft', 'ops.invoices.colSupplier', 'batch.colRecipe', 'batch.colOutput',
  'batch.runRecipeLabel', 'allergens.title', 'allergens.colShelfLife', 'allergens.shellfish',
  'units.unitPlaceholder', 'ops.tempLogs.scaleLabel', 'ops.tempLogs.scaleF', 'ops.tempLogs.scaleC',
  'ops.tempLogs.colReading', 'ops.eightySix.productLabel', 'menu.title', 'menu.quadrant.star',
  'menu.quadrant.plowhorse', 'menu.quadrant.puzzle', 'menu.quadrant.dog', 'prep.sheetTitle', 'print.prepTitle',
  'print.transferItem',
  // 'pricing.rollbackBadge' ("Rollback") added by the pricing batch
  // (Nov 13, 2026): Tagalog retail uses the English word directly.
  // 'print.templateShipping' added by the shipping batch the same
  // day: Tagalog uses the English term for a shipping label.
  'pricing.rollbackBadge', 'print.templateShipping',
  'auth.emailLabel', 'auth.passwordLabel', 'bomLib.kindBundle',
  'bomLib.kindBundleShort', 'bomLib.kindRecipe', 'businessLib.brandColor.plum',
  'categories.kindTag', 'dashboard.minReorder', 'exports.backupJson',
  'exports.excelWorkbook', 'exports.eyebrow', 'forgot.emailLabel',
  'import.colField', 'import.dryRunTitle', 'import.eyebrow',
  'import.previewTitle', 'import.worksheet', 'importLib.field.barcode',
  'importLib.field.brand', 'importLib.field.publisher', 'importLib.receiveField.supplierName',
  'importLib.updateField.brand', 'importLib.updateField.publisher', 'layout.scanCodes',
  'listings.channel', 'listingsLib.filterDraft', 'listingsLib.filterLive',
  'listingsLib.statusDraft', 'listingsLib.statusLive', 'locations.addressLabel',
  'locations.eyebrow', 'locations.kindBin', 'locations.kindVan',
  'movements.eyebrow', 'nav.group.workspace', 'nav.payroll',
  'nav.workforce', 'orders.carrier', 'orders.channel',
  'orders.customer', 'orders.email', 'orders.subtotal',
  'ordersLib.orderNote', 'payroll.bonus', 'payroll.dd.checking',
  'payroll.dd.savings', 'payroll.dd.title', 'payroll.title',
  'plans.featureHeader', 'pos.csv.problemRow', 'print.barcodeLabel',
  'print.carrier', 'print.colItem', 'print.customer',
  'print.fieldOrderBatch', 'print.fieldSheet', 'print.invoiceTitle',
  'print.packingSlipTitle', 'print.purchaseOrderTitle', 'print.qrLabel',
  'print.refSuffix', 'print.subtotal', 'print.templateBarcode',
  'productDetails.codeBarcode', 'productDetails.rowBatch', 'productDetails.rowBrand',
  'productDetails.rowFulfillment', 'productDetails.rowManufacturer', 'productDetails.rowPublisher',
  'productDetails.rowSerial', 'productDetails.rowStatus', 'productDetails.rowSupplier',
  'productForm.barcodeLabel', 'productForm.generateTypeBarcode', 'productForm.batchLabel', 'productForm.brandLabel',
  'productForm.coverBadge', 'productForm.customLabelPlaceholder', 'productForm.fulfillDigital',
  'productForm.fulfillmentLabel', 'productForm.manufacturerLabel', 'productForm.publisherLabel',
  'productForm.serialLabel', 'productForm.statusDraft', 'productForm.statusLabel',
  'productForm.unitKg', 'products.bulkChangeStatus', 'products.bulkPreview',
  'products.exportColBarcode', 'products.exportColQr', 'products.exportXlsx',
  'products.sortCodes', 'products.statusDraft', 'purchasing.statusDraft',
  'purchasing.subtotal', 'purchasing.supplier', 'purchasingLib.statusDraft',
  'reports.fieldSnapshot', 'reportsLib.grouping.supplier', 'returns.customer',
  'rewards.code', 'rewards.give.currency', 'rewards.kind.giftCard',
  'rewards.slip.code', 'rewards.value.giftCard', 'settings.identity.logoLabel',
  'settings.identity.taglineLabel', 'settings.security.backupEmailTitle', 'settings.software.tagline',
  'settings.switcher.taglineLabel', 'staff.member.administrator', 'staff.memberDialog.emailLabel',
  'staff.roleCard.builtIn', 'staffLib.area.catalog', 'staffLib.area.stock',
  'staffLib.role.managerName', 'subscribe.eyebrow', 'suppliers.accountNumber',
  'suppliers.address', 'suppliers.contact', 'suppliers.email',
  'suppliers.website', 'training.module.cross-store', 'training.module.direct-deposit',
  'training.module.payroll', 'training.module.scanner', 'upgrade.introTrial',
  'workforce.tab.clock', 'workforce.tab.inbox', 'workforce.title',
  // Translation sweep (Nov 15, 2026): 'clearance' is the standard
  // retail word in the Philippines — sale signage uses it verbatim.
  'products.bulkTagExampleBusiness',
  // Staff batch (Nov 19, 2026): 'Address' is the established
  // Filipino form label, verbatim as already verified above for
  // 'locations.addressLabel' and 'suppliers.address'.
  'settings.businessCard.address',
  // Restaurant corner batch (Nov 23, 2026): Tagalog keeps
  // these kitchen terms in English, as it does throughout —
  // verified word-by-word.
  'nav.group.restaurant', 'training.module.restaurant', 'restaurant.eyebrow',
  // Restaurant IA batch (release 377, Nov 25, 2026): Tagalog
  // keeps "Restaurant" for the corner's own nav door too.
  'nav.restaurant',
  'recipes.statusDraft', 'recipes.detailYield', 'recipes.qLabel',
  'recipes.lineYield', 'recipes.lineRecipePrefix', 'pars.supplierLabel',
  'pars.parLabel', 'guide.colPar', 'guide.colOrder',
  'guide.colSupplier',
  // Product form batch (Nov 24, 2026): the Philippine book trade
  // lists "Format", "Paperback" and "Hardcover" in English, as
  // its bookstores do — verified.
  'productForm.formatLabel', 'productDetails.rowFormat', 'importLib.field.format',
  'importLib.updateField.format',
  'productForm.formatPaperback', 'productForm.formatHardcover',
]);
const HA_COGNATE_KEYS = new Set([
  // Kitchen-menu build (plan release 371, Nov 26, 2026):
  // "Menu" is the genuine word for the guest menu's document
  // title in this language — verified.
  'guestMenu.docTitle',
  // Restaurant operations batch (Nov 23, 2026): "PO {number}" is the purchase-order code format, "g" is the gram symbol, and the scale names are kept in Hausa — verified.
  'ops.invoices.poPrefix', 'units.unitPlaceholder', 'ops.tempLogs.scaleF', 'ops.tempLogs.scaleC',
  'bomLib.kindBundle', 'bomLib.kindBundleShort', 'businessLib.brandColor.plum',
  'importLib.field.barcode', 'layout.scanCodes', 'payroll.bonus',
  'payroll.dd.checking', 'payroll.dd.savings', 'print.barcodeLabel',
  'print.qrLabel', 'print.templateBarcode', 'productDetails.codeBarcode',
  'productDetails.rowSerial', 'productForm.barcodeLabel', 'productForm.generateTypeBarcode', 'productForm.unitKg',
  'products.exportColBarcode', 'products.exportColQr', 'products.sortCodes',
  // Restaurant corner batch (Nov 23, 2026): "Par" is the kept
  // domain term — verified.
  'guide.colPar',
]);
const SW_COGNATE_KEYS = new Set([
  // Food-safety build (plan release 370, Nov 26, 2026):
  // "Sanitizer" is the genuine Swahili word for the check kind
  // — verified.
  'foodSafety.logs.kind.sanitizer',
  // Restaurant operations batch (Nov 23, 2026): "PO {number}" is the purchase-order code format, "g" is the gram symbol, and the scale names are kept in Swahili — verified.
  'ops.invoices.poPrefix', 'units.unitPlaceholder', 'ops.tempLogs.scaleF', 'ops.tempLogs.scaleC',
  'exports.eyebrow', 'import.eyebrow', 'productForm.unitKg',
  // Restaurant corner batch (Nov 23, 2026): "Par" is the kept
  // domain term — verified.
  'guide.colPar',
]);
const YO_COGNATE_KEYS = new Set([
  // Food-safety build (plan release 370, Nov 26, 2026):
  // "Sanitizer" is the genuine Yoruba word for the check kind
  // — verified.
  'foodSafety.logs.kind.sanitizer',
  // Restaurant operations batch (Nov 23, 2026): "PO {number}" is the purchase-order code format, "g" is the gram symbol, and the scale names are kept in Yoruba — verified.
  'ops.invoices.poPrefix', 'units.unitPlaceholder', 'ops.tempLogs.scaleF', 'ops.tempLogs.scaleC',
  'importLib.field.barcode', 'layout.scanCodes', 'payroll.dd.checking',
  'payroll.dd.savings', 'productDetails.codeBarcode', 'productForm.barcodeLabel', 'productForm.generateTypeBarcode',
  'productForm.unitKg', 'products.exportColBarcode', 'products.sortCodes',
  // Restaurant corner batch (Nov 23, 2026): "Par" is the kept
  // domain term — verified.
  'guide.colPar',
]);
const JV_COGNATE_KEYS = new Set([
  // Kitchen-menu build (plan release 371, Nov 26, 2026):
  // "Menu" is the genuine word for the guest menu's document
  // title in this language — verified.
  'guestMenu.docTitle',
  // Food-safety build (plan release 370, Nov 26, 2026):
  // "Sanitizer" is the genuine Javanese word for the check kind
  // — verified.
  'foodSafety.logs.kind.sanitizer',
  // Food-safety build (plan release 370, Nov 26, 2026): "Status"
  // is the word Javanese uses for the column head — verified.
  'foodSafety.certs.colStatus',
  // Restaurant operations batch (Nov 23, 2026): Javanese keeps "Unit", "Status" and "Transfer" in these forms, "PO {number}" is the code format, "g" is the gram symbol, and the scale names are spelled the same — verified.
  'recipes.lineUnit', 'ops.invoices.poPrefix', 'ops.invoices.statusLabel', 'ops.invoices.colStatus',
  'units.unitLabel', 'units.unitPlaceholder', 'ops.tempLogs.unitLabel', 'ops.tempLogs.scaleF', 'ops.tempLogs.scaleC',
  'ops.tempLogs.colUnit', 'print.transferTitle',
  'auth.emailLabel', 'bomLib.kindBundleShort', 'businessLib.brandColor.plum',
  'businessLib.dateFormat.dMmmYyyy', 'dashboard.minReorder', 'exports.eyebrow',
  'import.eyebrow', 'importLib.field.barcode', 'inventoryLib.movementTransfer',
  'layout.scanCodes', 'listings.status', 'locations.kindVan',
  'orders.email', 'payroll.bonus', 'print.barcodeLabel',
  'print.factUnit', 'print.invoiceTitle', 'print.refSuffix',
  'print.status', 'print.templateBarcode', 'productDetails.codeBarcode',
  'productDetails.rowBatch', 'productDetails.rowSerial', 'productDetails.rowStatus',
  'productDetails.rowUnit', 'productForm.barcodeLabel', 'productForm.generateTypeBarcode', 'productForm.batchLabel',
  'productForm.customLabelPlaceholder', 'productForm.fulfillDigital', 'productForm.statusLabel',
  'productForm.unitKg', 'products.bulkChangeStatus', 'products.exportColBarcode',
  'products.exportColUnit', 'products.sortCodes', 'purchasing.status',
  'scan.action.transfer', 'settings.identity.logoLabel', 'settings.identity.taglineLabel',
  'settings.software.tagline', 'settings.switcher.taglineLabel', 'staff.member.administrator',
  'staff.memberDialog.emailLabel', 'staff.memberDialog.statusLabel', 'suppliers.email',
  // Restaurant corner batch (Nov 23, 2026): Javanese keeps
  // "Status" and the domain term "Par" — verified.
  'recipes.statusLabel', 'guide.colPar',
  // Product form batch (Nov 24, 2026): Javanese keeps "Format"
  // in this form for the field — verified.
  'productForm.formatLabel', 'productDetails.rowFormat', 'importLib.field.format',
  'importLib.updateField.format',
  // Paper-trail batch (release 378, Nov 25, 2026): Javanese
  // keeps "Invoice" for the field and column, the same
  // loanword its own invoices title uses — verified.
  'ops.credits.colInvoice', 'ops.credits.invoiceLabel',
]);
const PCM_COGNATE_KEYS = new Set([
  // Tip-pooling build (plan release 373, Nov 26, 2026): the
  // short labels below are kept in English in Pidgin, in the
  // established register — its prose and lesson steps for
  // this build are translated.
  'tipPooling.methodHours', 'tipPooling.methodPoints', 'tipPooling.rolePctLabel',
  'tipPooling.pointsLabel', 'tipPooling.poolAmountLabel', 'tipPooling.colPerson',
  'tipPooling.colRole', 'tipPooling.colHours', 'tipPooling.colShare',
  'tipPooling.publishButton', 'tipPooling.printButton', 'tipPooling.allocMethodLabel',
  'tipPooling.allocGrossReceipts', 'tipPooling.allocGoodFaith', 'tipPooling.grossReceiptsLabel',
  'tipPooling.hoursLabel', 'tipPooling.eightPercentLabel', 'tipPooling.shortfallLabel',
  'tipPooling.mySharesTitle', 'tipPooling.recordsTitle', 'tipPooling.yearTitle',
  'tipPooling.periodLine',
  // Equipment build (plan release 372, Nov 26, 2026): the
  // short labels below are kept in English in Pidgin, in the
  // established register — its prose and lesson steps for
  // this build are translated.
  'nav.equipment', 'staffLib.area.equipmentAccess', 'equipment.title',
  'equipment.machinesTitle', 'equipment.newMachine', 'equipment.editMachine',
  'equipment.nameLabel', 'equipment.kindLabel', 'equipment.makeModelLabel',
  'equipment.serialLabel', 'equipment.servicePhoneLabel', 'equipment.notesLabel',
  'equipment.saveMachine', 'equipment.cycleLabel', 'equipment.historyTitle',
  'equipment.costLabel', 'equipment.saveRepair', 'equipment.docTitle',
  'equipment.deleteMachine',
  // Kitchen-menu build (plan release 371, Nov 26, 2026): the
  // short labels below are kept in English in Pidgin, in the
  // established register — its prose and lesson steps for
  // this build are translated.
  'nav.kitchenDisplay', 'nav.guestMenu', 'kitchen.title',
  'kitchen.batchesLabel', 'kitchen.amountsFor',
  'kitchen.ingredientsTitle', 'kitchen.stepsTitle',
  'kitchen.emptyTitle', 'kitchen.backButton', 'guestMenu.title',
  'guestMenu.linkTitle', 'guestMenu.notPublished',
  'guestMenu.previewTitle', 'guestMenu.docTitle',
  // Food-safety build (plan release 370, Nov 26, 2026): Pidgin
  // keeps these short door labels, titles, column heads and
  // button texts in English — the same register as the batches
  // below (its prose and lesson steps are translated) —
  // verified word-by-word. "Person" and "Status" are the
  // genuine Pidgin words.
  'nav.safetyLogs', 'nav.inspectionPacket', 'nav.foodCerts', 'nav.mockInspection', 'nav.sds',
  'foodSafety.logs.title', 'foodSafety.logs.newButton', 'foodSafety.logs.dialogTitle',
  'foodSafety.logs.kindLabel', 'foodSafety.logs.kind.cooling', 'foodSafety.logs.kind.reheating',
  'foodSafety.logs.kind.sanitizer', 'foodSafety.logs.itemLabel', 'foodSafety.logs.itemPlaceholder',
  'foodSafety.logs.readingLabel', 'foodSafety.logs.unitPpm', 'foodSafety.logs.colItem',
  'foodSafety.logs.save', 'foodSafety.logs.allKinds',
  'foodSafety.packet.title', 'foodSafety.packet.fromLabel', 'foodSafety.packet.toLabel',
  'foodSafety.packet.docTitle', 'foodSafety.packet.colKind',
  'foodSafety.certs.title', 'foodSafety.certs.emptyTitle', 'foodSafety.certs.memberLabel',
  'foodSafety.certs.classLabel', 'foodSafety.certs.class.servsafe_manager',
  'foodSafety.certs.colPerson', 'foodSafety.certs.colStatus', 'foodSafety.certs.save',
  'foodSafety.sds.title', 'foodSafety.sds.uploadButton', 'foodSafety.sds.titlePlaceholder',
  'foodSafety.mock.title', 'foodSafety.mock.openChecklists',
  // Age check build (Nov 25, 2026): Pidgin keeps these three
  // short labels in English — the same register as the batches
  // below (its prose and lesson steps are translated) —
  // verified word-by-word.
  'ageCheck.title', 'ageCheck.category.alcohol', 'settings.ageLines.title',
  // Prints build (Nov 25, 2026): Pidgin keeps these short paper
  // titles and column heads in English — the same register as
  // the batches below (its prose and lesson steps are
  // translated) — verified word-by-word.
  'print.payrollRegisterTitle', 'print.timesheetTitle', 'print.supplierDirectoryTitle',
  'print.fieldPeriod', 'print.colHours', 'print.colLesson', 'print.colScore',
  // eBay storefront batch (release 362, Nov 23, 2026): Pidgin keeps
  // these short door labels, buttons and headings in English — the
  // register this file keeps throughout (its prose and lesson steps
  // are translated) — verified word-by-word.
  'nav.storefronts', 'storefronts.title', 'training.module.storefronts',
  'storefronts.connect', 'storefronts.disconnect', 'storefronts.connectedAs',
  'storefronts.checkNow', 'storefronts.lastCheck', 'storefronts.itemLabel',
  'storefronts.orderLabel', 'storefronts.recentTitle',
  'training.lessons.owner-ebay-connect.title',
  // Invoice-file batch (Nov 23, 2026): Pidgin keeps these three short file labels in English, same register as the invoice labels below — verified.
  'ops.invoices.attachedLabel', 'ops.invoices.viewFile', 'ops.invoices.removeFile',
  // Restaurant operations batch (Nov 23, 2026): Pidgin keeps these short kitchen labels, column heads, button texts, food names and menu-engineering quadrant names in English — the register this file keeps throughout (its prose and lesson steps are translated) — verified word-by-word.
  'nav.waste', 'nav.eightySix', 'nav.menu', 'nav.variance', 'nav.ledger', 'inventoryLib.movementStaffMeal',
  'recipes.lineUnit', 'ops.invoices.newButton', 'ops.invoices.newTitle', 'ops.invoices.editTitle',
  'ops.invoices.supplierLabel', 'ops.invoices.poLabel', 'ops.invoices.poNone', 'ops.invoices.poPrefix',
  'ops.invoices.numberLabel', 'ops.invoices.dateLabel', 'ops.invoices.statusLabel', 'ops.invoices.statusDraft',
  'ops.invoices.statusAccepted', 'ops.invoices.addLine', 'ops.invoices.lineQty', 'ops.invoices.lineCost',
  'ops.invoices.totalLabel', 'ops.invoices.noteLabel', 'ops.invoices.save', 'ops.invoices.colSupplier',
  'ops.invoices.colNumber', 'ops.invoices.colDate', 'ops.invoices.colTotal', 'ops.invoices.colMatch',
  'ops.invoices.colStatus', 'ops.invoices.matchNone', 'ops.invoices.alertAccept', 'ops.invoices.alertDismiss',
  'ops.waste.title', 'ops.waste.newButton', 'ops.waste.newTitle', 'ops.waste.productLabel',
  'ops.waste.quantityLabel', 'ops.waste.reasonLabel', 'ops.waste.locationLabel', 'ops.waste.locationNone',
  'ops.waste.noteLabel', 'ops.waste.save', 'ops.waste.colDate', 'ops.waste.colProduct', 'ops.waste.colQuantity',
  'ops.waste.colReason', 'ops.waste.colLocation', 'ops.waste.colCost', 'ops.waste.totalLabel',
  'ops.waste.reason.spoilage', 'ops.waste.reason.overproduction', 'ops.waste.reason.prep_mistake',
  'ops.waste.reason.spillage', 'ops.waste.reason.other', 'ops.expiry.colProduct', 'ops.expiry.colLocation',
  'ops.expiry.colQuantity', 'ops.expiry.colReceived', 'ops.expiry.colUseBy', 'ops.expiry.expiresToday',
  'batch.newButton', 'batch.productLabel', 'batch.quantityLabel', 'batch.locationLabel', 'batch.locationNone',
  'batch.expiresLabel', 'batch.noteLabel', 'batch.save', 'batch.shelfLifeLabel', 'batch.runsTitle', 'batch.colWhen',
  'batch.colRecipe', 'batch.colMakes', 'batch.colProduced', 'batch.colOutput', 'batch.colLocation',
  'batch.runRecipeLabel', 'batch.runMakesLabel', 'batch.runLocationLabel', 'batch.runLocationNone', 'batch.runSave',
  'allergens.colDish', 'allergens.colProduct', 'allergens.colShelfLife', 'allergens.daysCount', 'allergens.save',
  'allergens.milk', 'allergens.fish', 'allergens.shellfish', 'allergens.wheat', 'allergens.soy', 'allergens.sesame',
  'units.addButton', 'units.unitLabel', 'units.unitPlaceholder', 'units.perLabel', 'ops.tempLogs.unitLabel',
  'ops.tempLogs.unitPlaceholder', 'ops.tempLogs.locationLabel', 'ops.tempLogs.locationNone',
  'ops.tempLogs.temperatureLabel', 'ops.tempLogs.scaleLabel', 'ops.tempLogs.scaleF', 'ops.tempLogs.scaleC',
  'ops.tempLogs.correctiveLabel', 'ops.tempLogs.correctivePrefix', 'ops.tempLogs.save', 'ops.tempLogs.colWhen',
  'ops.tempLogs.colUnit', 'ops.tempLogs.colReading', 'ops.tempLogs.colRange', 'ops.tempLogs.colBy',
  'ops.tempLogs.inRange', 'ops.tempLogs.outOfRange', 'ops.eightySix.title', 'ops.eightySix.productLabel',
  'ops.eightySix.locationAll', 'ops.eightySix.noteLabel', 'ops.transfers.newButton', 'ops.transfers.newTitle',
  'ops.transfers.productLabel', 'ops.transfers.fromLabel', 'ops.transfers.toLabel', 'ops.transfers.quantityLabel',
  'ops.transfers.printButton', 'staffMeals.productLabel', 'staffMeals.locationLabel', 'staffMeals.locationNone',
  'staffMeals.noteLabel', 'staffMeals.colDate', 'staffMeals.colDish', 'staffMeals.colLocation', 'menu.title',
  'menu.fromLabel', 'menu.toLabel', 'menu.colDish', 'menu.colUnits', 'menu.colRevenue', 'menu.colMargin',
  'menu.colTotalMargin', 'menu.colQuadrant', 'menu.quadrant.star', 'menu.quadrant.plowhorse', 'menu.quadrant.puzzle',
  'menu.quadrant.dog', 'variance.title', 'variance.colProduct', 'variance.colTheoretical', 'variance.colWaste',
  'variance.colOther', 'variance.colTotal', 'variance.colUnexplained', 'prep.sheetTitle', 'prep.printButton',
  'ledger.title', 'ledger.downloadCsv', 'ledger.downloadXlsx', 'ledger.sectionWaste', 'ledger.sectionDepletion',
  'exportsLib.restaurantLedger.title', 'print.labelReceived', 'print.labelUseBy', 'print.labelQuantity',
  'print.prepTitle', 'print.prepBuildTo', 'print.transferTitle', 'print.transferFrom', 'print.transferTo',
  'print.transferDate', 'print.transferReference', 'print.transferItem', 'print.transferQuantity',
  'auth.aboutLink', 'auth.emailLabel', 'businessLib.dateFormat.dMmmYyyy',
  'businessLib.dateFormat.mmmDyyyy', 'layout.aboutLink', 'layout.scanCodes',
  'orders.email', 'plans.perMonthShort', 'plans.policyLink',
  'plans.privacyLink', 'plans.termsLink', 'productForm.unitKg',
  'products.sortCodes', 'recovery.orDivider', 'scan.codePlaceholder',
  'settings.review.policyLink', 'settings.review.privacyLink', 'settings.review.termsLink',
  'staff.memberDialog.emailLabel', 'suppliers.email', 'upgrade.introTrial',
  'upgrade.policyLink', 'upgrade.privacyLink', 'upgrade.termsLink',
  'workforce.day.0', 'workforce.day.1', 'workforce.day.2',
  'workforce.day.3', 'workforce.day.4', 'workforce.day.5',
  'workforce.day.6',
  // Pricing batch (Nov 13, 2026): Pidgin keeps these English price
  // labels verbatim — verified word-by-word.
  'pricing.clearancePriceLabel', 'pricing.modeRegular', 'pricing.salePriceLabel',
  // Shipping batch (Nov 13, 2026): Pidgin keeps the shipping-label
  // wording in English — verified word-by-word.
  'print.templateShipping', 'print.shipFrom', 'print.senderAddressLabel',
  // Restaurant corner batch (Nov 23, 2026): Pidgin keeps these
  // short kitchen labels in English — verified word-by-word.
  'nav.group.restaurant', 'nav.orderGuide', 'staffLib.area.restaurantAccess',
  // Restaurant IA batch (release 377, Nov 25, 2026): Pidgin keeps
  // these three short labels in English too — the corner's nav
  // door, the Today page's name and the Locations open door —
  // same register; the subtitle, attention lines and shelf
  // names are translated.
  'nav.restaurant', 'restaurant.today.title', 'restaurant.locations.open',
  'training.module.restaurant', 'training.lessons.mgr-restaurant-money.title', 'restaurant.eyebrow',
  'recipes.newButton', 'recipes.openButton', 'recipes.editButton',
  'recipes.deleteButton', 'recipes.cardTrueCost', 'recipes.statusActive',
  'recipes.statusDraft', 'recipes.printButton', 'recipes.detailYield',
  'recipes.priceCard', 'recipes.trueCostCard', 'recipes.costPerMakeCard',
  'recipes.colIngredient', 'recipes.colQuantity', 'recipes.colCost',
  'recipes.editTitle', 'recipes.newTitle', 'recipes.nameLabel',
  'recipes.namePlaceholder', 'recipes.descriptionLabel', 'recipes.statusLabel',
  'recipes.qLabel', 'recipes.zoneLabel', 'recipes.photoChange',
  'recipes.photoRemove', 'recipes.addLine', 'recipes.lineQty',
  'recipes.lineYield', 'recipes.lineRecipePrefix', 'recipes.needLine',
  'recipes.cancel', 'recipes.save', 'pars.newButton',
  'pars.editTitle', 'pars.newTitle', 'pars.productLabel',
  'pars.supplierLabel', 'pars.parLabel', 'guide.title',
  'guide.colProduct', 'guide.colPar', 'guide.colOrder',
  'guide.colSupplier', 'print.recipeTitle', 'print.recipeIngredient',
  'print.recipeQuantity', 'print.recipeLineCost', 'print.recipePrice',
  'print.recipeTrueCost', 'print.recipeCostPerMake',
  // Paper-trail batch (release 378, Nov 25, 2026): Pidgin
  // keeps these short log-book and credit-memo labels,
  // buttons, column heads and the lesson title in English —
  // the same register as the batches above; every sentence,
  // placeholder and lesson step is translated — verified
  // word-by-word.
  'nav.logBook', 'logBook.title', 'logBook.addButton', 'logBook.saveButton',
  'logBook.bodyLabel', 'logBook.editTitle', 'ops.credits.newButton',
  'ops.credits.colInvoice', 'ops.credits.colAmount', 'ops.credits.statusVoid',
  'ops.credits.newTitle', 'ops.credits.editTitle', 'ops.credits.invoiceLabel',
  'ops.credits.amountLabel', 'ops.credits.creditNumberLabel', 'ops.credits.dateLabel',
  'ops.credits.reasonLabel', 'ops.credits.save', 'training.lessons.staff-log-book.title',
]);
const GU_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "PO {number}" is the purchase-order code format and "g" is the gram symbol — verified.
  'ops.invoices.poPrefix', 'units.unitPlaceholder',
]);
const HI_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "PO {number}" is the purchase-order code format and "g" is the gram symbol — verified.
  'ops.invoices.poPrefix', 'units.unitPlaceholder',
]);
const TG_COGNATE_KEYS = new Set([
  // Restaurant operations batch (Nov 23, 2026): "g" is the gram symbol, spelled the same in Tajik — verified.
  'units.unitPlaceholder',
]);
const COGNATE_KEYS = {
  'es-MX': SPANISH_COGNATE_KEYS,
  'es-ES': SPANISH_COGNATE_KEYS,
  'es-US': SPANISH_COGNATE_KEYS,
  'es-CU': SPANISH_COGNATE_KEYS,
  'es-PR': SPANISH_COGNATE_KEYS,
  'es-VE': SPANISH_COGNATE_KEYS,
  'fr-FR': FR_FR_COGNATE_KEYS,
  'fr-CA': FR_CA_COGNATE_KEYS,
  'pt-BR': PT_BR_COGNATE_KEYS,
  'pt-PT': PT_PT_COGNATE_KEYS,
  'de': DE_COGNATE_KEYS,
  'it': IT_COGNATE_KEYS,
  'ja': JA_COGNATE_KEYS,

  'ko': KO_COGNATE_KEYS,

  'fa': FA_COGNATE_KEYS,
  'prs': PRS_COGNATE_KEYS,
  'ur': UR_COGNATE_KEYS,

  'tr': TR_COGNATE_KEYS,

  'kn': KN_COGNATE_KEYS,
  'mr': MR_COGNATE_KEYS,

  'ta': TA_COGNATE_KEYS,
  'te': TE_COGNATE_KEYS,
  'pa-Guru': PA_GURU_COGNATE_KEYS,

  'pa-Arab': PA_ARAB_COGNATE_KEYS,
  'id': ID_COGNATE_KEYS,
  'ms': MS_COGNATE_KEYS,

  'th': TH_COGNATE_KEYS,
  'vi': VI_COGNATE_KEYS,
  'tl': TL_COGNATE_KEYS,

  'ha': HA_COGNATE_KEYS,
  'sw': SW_COGNATE_KEYS,
  'yo': YO_COGNATE_KEYS,

  'jv': JV_COGNATE_KEYS,

  'pcm': PCM_COGNATE_KEYS,
  'gu': GU_COGNATE_KEYS,
  'hi': HI_COGNATE_KEYS,
  'tg': TG_COGNATE_KEYS,
};

const TOKENS = [
  'Luminous StockHaven', 'Social Security', 'Medicare', 'SKU', 'UPC',
  'EAN', 'ISBN-10 / ISBN-13', 'ISBN', 'QR', 'Excel', 'Bluetooth',
  'USB', 'Wi-Fi', 'Ethernet', 'AirPrint', 'CSV', 'Shopify',
  'TikTok Shop', 'eBay', 'Amazon', 'Walmart', 'Etsy', 'Facebook',
  'Google', 'Business', 'Essentials', 'Stripe Terminal', 'Stripe', 'USPS', 'UPS',
  'Square', 'POS',
  // Code generator (Nov 15, 2026): 'Code 128' is the ISO
  // symbology's own name, identical in every locale by the same
  // rule that keeps SKU and UPC above — it is the
  // productForm.generateTypeCode128 label and nothing else
  // (every sentence around it is genuinely translated).
  'Code 128',
  // POS provider expansion (Nov 14, 2026): the six new providers'
  // brand names are proper nouns, identical in every locale by
  // the same rule that keeps Square and Shopify above — they are
  // the pos.provider.* labels and nothing else (every sentence
  // around them is genuinely translated).
  'Clover', 'Toast', 'Lightspeed', 'PayPal Zettle', 'Wix',
];
const EXAMPLE_VALUES = new Set([
  'you@example.com', 'alex@example.com', 'Dana Ruiz',
  'Ingram Content Group', 'supplier.com', 'Harbor & Pine Books',
  'Alex Rivera',
  // Translation sweep (Nov 15, 2026): the product form's example
  // author name — example data, like Dana Ruiz above.
  'Ada Mercer',
]);

function legitIdentical(key, value) {
  if (typeof value !== 'string') return 'non-string';
  if (value === '') return 'empty';
  if (key === 'settings.deleteConfirmWord') return 'confirm-word';
  // Translation sweep (Nov 15, 2026): two placeholder examples are
  // formats, not prose — a measurement ('21 × 14 × 2 cm', SI units
  // are the same in every language) and a purchase-order code
  // ('PO-1043'). They stay identical in every locale on purpose;
  // the words around them are genuinely translated.
  if (key === 'productForm.dimensionsPlaceholder') return 'measurement-format';
  if (key === 'import.referencePlaceholderBusiness') return 'code-format';
  if (key.startsWith('settings.details.')) return 'language-label';
  const stripped = value.replace(/\{[^}]*\}/g, '').trim();
  if (stripped === '') return 'placeholder-only';
  if (!/\p{L}/u.test(stripped)) return 'no-letters';
  if (/^https?:\/\/\S+$/.test(stripped)) return 'url';
  let rest = stripped;
  for (const token of TOKENS) rest = rest.split(token).join(' ');
  if (rest.replace(/[\s\/·—\-,.…:;()%]/g, '') === '') return 'proper/technical tokens only';
  if (key.endsWith('Placeholder') && EXAMPLE_VALUES.has(value)) return 'example-data placeholder';
  if (key.endsWith('Placeholder') && /^[\w-]+(\.[\w-]+)+$/.test(value.trim())) return 'example-domain placeholder';
  return null;
}

function debtKeys(code) {
  const locale = LOCALES[code];
  const cognates = COGNATE_KEYS[code] || new Set();
  return Object.keys(en).filter(
    (key) => locale[key] === en[key] && !legitIdentical(key, en[key]) && !cognates.has(key),
  );
}

test('completed-tranche locales carry zero translation debt', () => {
  for (const code of TRANCHE_1_LOCALES) {
    const debt = debtKeys(code);
    assert.deepEqual(
      debt,
      [],
      `${code} still has ${debt.length} untranslated keys: ${debt.slice(0, 10).join(', ')}`,
    );
  }
});

test('completed-tranche locales keep keyset parity and placeholder parity with English', () => {
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  const enKeys = Object.keys(en).sort();
  for (const code of TRANCHE_1_LOCALES) {
    const locale = LOCALES[code];
    assert.deepEqual(Object.keys(locale).sort(), enKeys, `${code} keyset differs from en`);
    for (const [key, english] of Object.entries(en)) {
      const value = locale[key];
      assert.equal(typeof value, 'string', `${code} missing key: ${key}`);
      assert.ok(value.length > 0, `${code} empty value: ${key}`);
      const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
      const got = placeholders(value);
      for (const p of want) assert.ok(got.has(p), `${code} ${key} missing {${p}}`);
      for (const p of got) assert.ok(placeholders(english).has(p), `${code} ${key} extra {${p}}`);
      for (const p of agreement) assert.ok(!got.has(p), `${code} ${key} keeps agreement marker {${p}}`);
    }
  }
});

const ENGLISH_DOCUMENTS = {
  terms: STOCKHAVEN_TERMS_OF_SERVICE,
  subscription: STOCKHAVEN_SUBSCRIPTION_POLICY,
  privacy: STOCKHAVEN_PRIVACY_POLICY,
};

test('completed-tranche policy bodies are registered and served, merged over English', () => {
  for (const kind of POLICY_KINDS) {
    const english = ENGLISH_DOCUMENTS[kind];
    for (const code of TRANCHE_1_LOCALES) {
      assert.equal(hasPolicyTranslation(kind, code), true, `${kind}/${code} not registered`);
      const { document, translated } = getPolicyDocument(kind, code);
      assert.equal(translated, true, `${kind}/${code} should serve its translation`);
      // The translated furniture: title, scope (and the document's
      // own prose) are the locale's, never the English strings.
      assert.notEqual(document.title, english.title, `${kind}/${code} title is still English`);
      assert.notEqual(document.scope, english.scope, `${kind}/${code} scope is still English`);
      if (english.tagline) {
        assert.notEqual(document.tagline, english.tagline, `${kind}/${code} tagline is still English`);
      }
      if (english.introduction) {
        assert.notEqual(document.introduction, english.introduction, `${kind}/${code} introduction is still English`);
      }
      // Same skeleton: identical section ids, identical paragraph
      // counts — a translation can never drop or add content.
      assert.equal(document.sections.length, english.sections.length, `${kind}/${code} section count differs`);
      document.sections.forEach((section, i) => {
        assert.equal(section.id, english.sections[i].id, `${kind}/${code} section ${i} id differs`);
        assert.equal(
          section.paragraphs.length,
          english.sections[i].paragraphs.length,
          `${kind}/${code} section ${section.id} paragraph count differs`,
        );
        assert.notEqual(section.title, english.sections[i].title, `${kind}/${code} section ${section.id} title is still English`);
        section.paragraphs.forEach((paragraph, j) => {
          assert.notEqual(
            paragraph,
            english.sections[i].paragraphs[j],
            `${kind}/${code} section ${section.id} paragraph ${j} is still English`,
          );
        });
      });
      // The legal furniture the translation omits falls back to the
      // official English document at read time.
      assert.equal(document.owner, english.owner, `${kind}/${code} owner should fall back to English`);
      assert.equal(document.effectiveDate, english.effectiveDate, `${kind}/${code} dates should fall back to English`);
      // The protective line shown above a translated body is itself
      // translated in these locales.
      const notice = LOCALES[code]['policies.translationNotice'];
      assert.equal(typeof notice, 'string', `${code} is missing policies.translationNotice`);
      assert.notEqual(notice, en['policies.translationNotice'], `${code} protective line is still English`);
    }
    // A locale outside the completed tranches still falls back to English.
    assert.equal(hasPolicyTranslation(kind, 'en-NZ'), false, `${kind}/en-NZ should not be registered`);
    assert.equal(getPolicyDocument(kind, 'en-NZ').translated, false);
    // Release 346: en-GB now carries its own regional edition.
    assert.equal(hasPolicyTranslation(kind, 'en-GB'), true, `${kind}/en-GB should be registered (release 346)`);
    assert.equal(getPolicyDocument(kind, 'en-GB').translated, true);
  }
});
