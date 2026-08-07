/**
 * Creates the Diamond Labs Rx → Seazona mapping sign-off form as a real Google
 * Form in your Drive.
 *
 * HOW TO RUN (about 30 seconds):
 *   1. Go to https://script.google.com and click "New project"
 *   2. Delete the placeholder code, paste this whole file in
 *   3. Click Run. Google will ask permission to create forms — approve it.
 *   4. The execution log prints two links: the form to send, and the
 *      responses sheet.
 *
 * The questions come from docs/rx-forms/mapping-status.md, which is generated
 * from the live mapping tables. If that document changes, regenerate it with
 * `pnpm --filter @my-app/api rx:mapping-report` and update this file to match.
 */

function createLabSignoffForm() {
  var form = FormApp.create('Diamond Labs — Rx to Seazona mapping sign-off');

  form.setDescription(
    'We map each prescription selection to a product code in Seazona by reading your live catalog. ' +
    'Most of it resolves on its own: the catalog names products as appliance + material, and the Rx form ' +
    'asks the doctor those same two things.\n\n' +
    'Two things break that pattern, and both are below. Either the form does not ask something the catalog ' +
    'needs (usually the material), or your catalog has more than one product that could fit.\n\n' +
    'Until you answer, orders using these selections are HELD — we never guess a product code.\n\n' +
    'Forty-one selections are already settled and need nothing from you.'
  );

  form.setCollectEmail(true);
  form.setProgressBar(true);

  // ── Part 1 — confirm or correct ──────────────────────────────────────────
  form.addPageBreakItem()
    .setTitle('Part 1 — Confirm or correct (6)')
    .setHelpText(
      'Each of these has one strong candidate in your catalog, but the prescription does not carry ' +
      'quite enough for us to be certain. Pick "Yes" or give us the right code.'
    );

  addConfirm(form,
    'Shirazi Hybrid — we propose 2152 (Shirazi Hybrid Nylon)',
    'The form never asks a material for the Shirazi Hybrid, and your catalog lists it only in Nylon. ' +
    'Is there any case where it is built in something else?',
    '2152');

  addConfirm(form,
    'CAD/CAM D-Pro — we propose 2539 (Dorsal Pro Nylon)',
    'D-Pro appears in your catalog as "Dorsal Pro", in Nylon (2539) and BioFlex (2540) at the same price. ' +
    'The form does not ask which, so we default to Nylon.',
    '2539');

  addConfirm(form,
    'MORA — we propose 2593 (MORA - PMT)',
    'MORA comes in PMT (2593) and ClearSplint (2594). The form is a simple tick with no material, ' +
    'so we default to PMT, the cheaper of the two.',
    '2593');

  addConfirm(form,
    'Nightguard, full occlusion in acrylic w/clasps — we propose 2428 (Nightguard All-Acrylic)',
    'The nearest catalog product is the all-acrylic nightguard, but the names do not match exactly ' +
    'and it is priced higher than the other nightguard materials.',
    '2428');

  addConfirm(form,
    'Neurosensory Stent — we propose 2597 (Neurostent BioFlex)',
    'Almost certainly the same appliance, but the catalog product is BioFlex only and the form ' +
    'does not ask a material.',
    '2597');

  addConfirm(form,
    'Hooks for lip-seal — we propose 2319 (Hooks For Elastic Retention)',
    'Your catalog has one hooks product. If lip-seal hooks are fabricated differently or priced ' +
    'differently, they need their own code.',
    '2319');

  // ── Part 2 — decisions ───────────────────────────────────────────────────
  form.addPageBreakItem()
    .setTitle('Part 2 — Decisions we cannot make for you (12)')
    .setHelpText(
      'We have no candidate for these, or more than one and no way to choose. ' +
      'Orders using any of these selections are held until you answer.'
    );

  var onMaterials = ['PMT', 'Acrylic w/clasps', 'Acrylic only', 'Dual-Laminate', 'Biomed', 'Nylon', 'BioFlex'];

  form.addMultipleChoiceItem()
    .setTitle('Olmos Night — which base material should we assume when the doctor does not say?')
    .setHelpText(
      'THIS IS THE HIGHEST-VALUE ANSWER ON THE FORM. The deprogrammer (ON-D), positioner (ON-P) and ' +
      'ramp (ON-R) each exist in six or seven materials, and the prescription never asks. ' +
      'Answering this turns three permanently-held order types into about twenty automatic mappings.\n\n' +
      'If the better fix is to add a material question to the Rx form instead, choose the last option.'
    )
    .setChoiceValues(onMaterials.concat(['Do not assume — add a material question to the Rx form']))
    .showOtherOption(true)
    .setRequired(true);

  form.addTextItem()
    .setTitle('Olmos Night — should ON-D, ON-P and ON-R each default differently?')
    .setHelpText('If the three designs have different usual materials, tell us which for each. Otherwise leave blank.');

  form.addMultipleChoiceItem()
    .setTitle('"Occlusal Guard — Slider Type": which product does a doctor mean?')
    .setHelpText('Your catalog has both NTI Slider-Type (2175 Biomed / 2176 Nylon) and FLATPLANE (2162 Biomed / 2163 Nylon / 2531 BioFlex).')
    .setChoiceValues(['NTI Slider-Type', 'FLATPLANE', 'Depends — explain below'])
    .showOtherOption(true)
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('"Dual Arch — SLIDER" on the device picker: same as NTI Slider-Type?')
    .setHelpText('The only slider product in the catalog is NTI Slider-Type. If yes, tell us which material to use when the doctor does not say.')
    .setChoiceValues([
      'Yes — NTI Slider-Type, Biomed (2175)',
      'Yes — NTI Slider-Type, Nylon (2176)',
      'Yes, but ask the doctor for a material',
      'No — different appliance'
    ])
    .showOtherOption(true)
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('"Single Arch — NIGHTGUARD" with no material: which should we build?')
    .setHelpText('Single-arch nightguards exist in five materials in your catalog.')
    .setChoiceValues([
      'PMT (2164)',
      'Biomed (2165)',
      'Nylon (2166)',
      'Dual Laminate (2167)',
      'All-Acrylic (2428)',
      'Do not assume — ask the doctor for a material'
    ])
    .showOtherOption(true)
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Design preference "Full Coverage" vs the product "Full Contact" (2292)')
    .setHelpText('Both exist. Are they the same thing?')
    .setChoiceValues([
      'Same thing — use 2292 Full Contact',
      'Different — full coverage needs its own code',
      'Different — full coverage is a build instruction only, no code'
    ])
    .showOtherOption(true)
    .setRequired(true);

  form.addSectionHeaderItem()
    .setTitle('Five build instructions with no product behind them')
    .setHelpText(
      'Nothing in your catalog matches any of these. For each: is it a priced add-on we should bill, ' +
      'or purely an instruction the technician reads?'
    );

  var buildInstructions = [
    'Wrap distal of last molars',
    'Keep last molars uncovered',
    'Create holes for cusps (minimum vertical)',
    'Anterior Pad',
    'No anterior buildup on trutaine/essix'
  ];

  buildInstructions.forEach(function (label) {
    form.addMultipleChoiceItem()
      .setTitle(label)
      .setChoiceValues([
        'Build instruction only — no charge, no line item',
        'Priced add-on — I will give the code below'
      ])
      .showOtherOption(true)
      .setRequired(true);
  });

  form.addTextItem()
    .setTitle('Codes for any of the five above that are priced add-ons')
    .setHelpText('Format: instruction = code. One per line. Leave blank if all five are build instructions only.');

  // ── Part 3 — orthodontics ────────────────────────────────────────────────
  form.addPageBreakItem()
    .setTitle('Part 3 — Orthodontics')
    .setHelpText('The largest open item, and the only one where we cannot offer even a first guess.');

  form.addParagraphTextItem()
    .setTitle('How should we map orthodontic appliances?')
    .setHelpText(
      'Your catalog carries roughly 36 orthodontic products — expanders, tandems, twin blocks — that ' +
      'differ by retention, screw type, clasp and base material. The Rx form captures all of those ' +
      'choices from the doctor. What we do not have is the rule connecting them.\n\n' +
      'Every orthodontic order is currently held.\n\n' +
      'Write anything useful here, or just say you would rather walk through it on a call — that is ' +
      'probably the faster route, working backwards from a few recent real orders.'
    );

  form.addMultipleChoiceItem()
    .setTitle('Would a call be easier for the orthodontic mapping?')
    .setChoiceValues(['Yes — set up a call', 'No — I will write it out', 'Someone else here should handle this'])
    .showOtherOption(true);

  // ── Close ────────────────────────────────────────────────────────────────
  form.addPageBreakItem().setTitle('Anything else');

  form.addParagraphTextItem()
    .setTitle('Anything we have got wrong, or anything missing?')
    .setHelpText(
      'Including any of the 41 settled mappings, if one looks wrong to you. ' +
      'The full list is in the sign-off document that came with this form.'
    );

  var sheet = SpreadsheetApp.create('Diamond Labs — Rx mapping sign-off (responses)');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());

  Logger.log('Send this to the lab:  %s', form.getPublishedUrl());
  Logger.log('Edit the form here:    %s', form.getEditUrl());
  Logger.log('Responses land here:   %s', sheet.getUrl());
}

/**
 * A "confirm or correct" question: one multiple choice where "Other" lets the
 * lab type the right code, so it stays a single question rather than two.
 */
function addConfirm(form, title, help, proposedCode) {
  form.addMultipleChoiceItem()
    .setTitle(title)
    .setHelpText(help)
    .setChoiceValues([
      'Yes — ' + proposedCode + ' is correct',
      'No — this should not be a line item at all'
    ])
    .showOtherOption(true)
    .setRequired(true);
}
