/**
 * Builds the Diamond Labs prescription-form questionnaire as a real Google Form
 * in your Drive, wired to a responses spreadsheet.
 *
 * HOW TO RUN (about 30 seconds):
 *   1. Go to https://script.google.com and click "New project"
 *   2. Delete the placeholder code, paste this whole file in
 *   3. Click Run. Google will ask permission to create forms — approve it.
 *   4. The execution log prints three links: the form to send, the form to
 *      edit, and the sheet the answers land in.
 *
 * Mirrors the sign-off document. Two kinds of question:
 *   Part 1 — is this how you want it mapped? (which product a choice becomes)
 *   Part 2 — is this what you want to happen? (how the form behaves)
 *
 * Keep this file in step with docs/rx-forms/mapping-status.md, which is
 * generated from the live mapping data (`pnpm --filter @my-app/api rx:mapping-report`).
 */

function createLabSignoffForm() {
  var form = FormApp.create('Diamond Labs — prescription form questions');

  form.setDescription(
    'Two kinds of question, and none of them need a technical answer.\n\n' +
    'PART 1 asks whether a doctor\'s choice turns into the right product. Most are already ' +
    'agreed — 41 of them — so only the unclear ones are here.\n\n' +
    'PART 2 asks whether the form behaves the way you want as a doctor fills it in. It used to ' +
    'show every question to every doctor; it now hides ones that do not apply. Those changes are ' +
    'listed so you can catch any that are wrong.\n\n' +
    'Anything you confirm is recorded against that exact choice, so you will not be asked again.'
  );

  form.setCollectEmail(true);
  form.setProgressBar(true);

  // ══ PART 1a — confirm a code ═══════════════════════════════════════════
  form.addPageBreakItem()
    .setTitle('Part 1 — Is this how you want it mapped?')
    .setHelpText(
      'Six where a product was picked as the most likely fit, because the prescription does not ' +
      'say quite enough to be certain. Say yes, or give the code you would rather use.'
    );

  confirm_(form,
    'Shirazi Hybrid — every one would be ordered as 2152 (Shirazi Hybrid Nylon)',
    'The prescription never asks which material a Shirazi Hybrid is made from, and your ' +
    'catalogue only lists it in nylon. Is a Shirazi Hybrid ever made in anything else?',
    '2152');

  confirm_(form,
    'CAD/CAM D-Pro — every one would be ordered as 2539 (Dorsal Pro Nylon)',
    'D-Pro is listed in your catalogue as "Dorsal Pro", in nylon (2539) and BioFlex (2540) at ' +
    'the same price. The prescription does not ask which. Is nylon the right default, or should ' +
    'the doctor be asked?',
    '2539');

  confirm_(form,
    'MORA — every one would be ordered as 2593 (MORA - PMT)',
    'MORA comes in PMT (2593) and ClearSplint (2594). On the prescription it is a simple tick ' +
    'with no material, so every one would be PMT, the cheaper of the two. Is that right?',
    '2593');

  confirm_(form,
    'Full-occlusion nightguard in acrylic w/clasps — 2428 (Nightguard All-Acrylic)',
    'The closest product in your catalogue is the all-acrylic nightguard, but the names do not ' +
    'match exactly and it costs more than the other nightguard materials. Is that the same appliance?',
    '2428');

  confirm_(form,
    'Neurosensory Stent — 2597 (Neurostent BioFlex)',
    'The prescription says "Neurosensory Stent"; your catalogue says "Neurostent". Almost ' +
    'certainly the same thing. The catalogue product is BioFlex only, and the prescription does ' +
    'not ask for a material. Same appliance, and always BioFlex?',
    '2597');

  confirm_(form,
    'Hooks for lip-seal — 2319 (Hooks For Elastic Retention)',
    'Your catalogue has one hooks product, so "hooks for lip-seal" and "hooks for elastics" ' +
    'would both be ordered as the same thing. Are lip-seal hooks made or priced differently?',
    '2319');

  // ══ PART 1b — choose a code ════════════════════════════════════════════
  form.addPageBreakItem()
    .setTitle('Part 1 continued — twelve where you need to choose')
    .setHelpText(
      'No product could be picked for these. Either nothing in your catalogue matches, or ' +
      'several do and nothing in the prescription says which. Any order using one of these is ' +
      'held rather than sent through with a guess.'
    );

  form.addMultipleChoiceItem()
    .setTitle('Olmos Night — what material should ON-D, ON-P and ON-R be?')
    .setHelpText(
      'THIS ONE UNLOCKS THE MOST. The deprogrammer, positioner and ramp each exist in six or ' +
      'seven materials, and the prescription never asks which. Answering this turns three held ' +
      'order types into about twenty automatic ones.\n\n' +
      'Either pick a single default, or say the doctor should be asked.'
    )
    .setChoiceValues([
      'PMT', 'Acrylic w/clasps', 'Acrylic only', 'Dual-Laminate', 'Biomed', 'Nylon', 'BioFlex',
      'Ask the doctor — add a material question to the prescription'
    ])
    .showOtherOption(true)
    .setRequired(true);

  form.addTextItem()
    .setTitle('Should ON-D, ON-P and ON-R each default to a different material?')
    .setHelpText('Only if the three designs differ. Otherwise leave blank.');

  form.addMultipleChoiceItem()
    .setTitle('"Occlusal Guard — Slider Type": which product does a doctor mean?')
    .setHelpText('Your catalogue has NTI Slider-Type (2175 biomed / 2176 nylon) and FLATPLANE (2162 biomed / 2163 nylon / 2531 BioFlex). Both dual-arch.')
    .setChoiceValues(['NTI Slider-Type', 'FLATPLANE', 'Depends — explained below'])
    .showOtherOption(true)
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('"Dual Arch — SLIDER" in the device list — same as NTI Slider-Type?')
    .setHelpText('That is the only slider product in your catalogue. If it is the same, which material should be used when the doctor does not say?')
    .setChoiceValues([
      'Yes — NTI Slider-Type in biomed (2175)',
      'Yes — NTI Slider-Type in nylon (2176)',
      'Yes, but the doctor should be asked for a material',
      'No — a different appliance'
    ])
    .showOtherOption(true)
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('"Single Arch — NIGHTGUARD" with no material — which should be built?')
    .setHelpText('Single-arch nightguards exist in five materials in your catalogue.')
    .setChoiceValues([
      'PMT (2164)', 'Biomed (2165)', 'Nylon (2166)', 'Dual Laminate (2167)', 'All-Acrylic (2428)',
      'Ask the doctor for a material'
    ])
    .showOtherOption(true)
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Design preference "Full Coverage" and the product "Full Contact" (2292)')
    .setHelpText('Both exist. Are they the same thing?')
    .setChoiceValues([
      'The same — use 2292 Full Contact',
      'Different — Full Coverage needs its own product code',
      'Different — Full Coverage is an instruction only, not a charge'
    ])
    .showOtherOption(true)
    .setRequired(true);

  form.addSectionHeaderItem()
    .setTitle('Five instructions with no product in your catalogue')
    .setHelpText('For each: should it be charged as an add-on, or is it just an instruction for the technician?');

  [
    'Wrap distal of last molars',
    'Keep last molars uncovered',
    'Create holes for cusps (minimum vertical)',
    'Anterior Pad',
    'No anterior buildup on trutaine/essix'
  ].forEach(function (label) {
    form.addMultipleChoiceItem()
      .setTitle(label)
      .setChoiceValues([
        'Instruction only — no charge',
        'Charge it — code given below'
      ])
      .showOtherOption(true)
      .setRequired(true);
  });

  form.addTextItem()
    .setTitle('Codes for any of the five above that should be charged')
    .setHelpText('One per line, in the form: instruction = code. Leave blank if none are charged.');

  // ══ PART 1c — orthodontics ═════════════════════════════════════════════
  form.addPageBreakItem()
    .setTitle('Part 1 continued — orthodontics')
    .setHelpText('The largest outstanding item, and the only one where no first guess was possible.');

  form.addParagraphTextItem()
    .setTitle('How should orthodontic appliances be mapped?')
    .setHelpText(
      'Your catalogue carries roughly 36 orthodontic products — expanders, tandems, twin blocks — ' +
      'that differ by retention, screw type, clasp and base material. The prescription asks the ' +
      'doctor all of those questions. What is missing is the rule connecting the answers to a ' +
      'product.\n\n' +
      'Until that exists, every orthodontic order is held.\n\n' +
      'Write whatever is useful, or say you would rather do it on a call — that is probably ' +
      'quicker, working backwards from a few recent real orders.'
    );

  form.addMultipleChoiceItem()
    .setTitle('Would a call be easier for orthodontics?')
    .setChoiceValues(['Yes — set up a call', 'No — I will write it out', 'Someone else here should answer this'])
    .showOtherOption(true);

  // ══ PART 2 — behaviour ═════════════════════════════════════════════════
  form.addPageBreakItem()
    .setTitle('Part 2 — Is this what you want to happen?')
    .setHelpText(
      'The prescription used to show every question to every doctor, whether it applied or not. ' +
      'It now hides ones that do not apply. Each of these is a change a doctor will notice. ' +
      'Please say if any is wrong.'
    );

  behaviour_(form,
    'The drawing pad appears only when a doctor asks to draw',
    'BEFORE: the drawing pad was always on screen, even for doctors who never intended to draw.\n' +
    'NOW: it appears when they tick "I would like to design (draw) my appliance".\n\n' +
    'This applies in all three orthodontic sections.');

  behaviour_(form,
    'Screw type and pontic tooth appear only when relevant (Olmos Day)',
    'BEFORE: "Expansion screw type" and "Pontic tooth #" were always shown.\n' +
    'NOW: each appears only after the doctor ticks "Add expansion screw" or "Add pontic(s)".');

  behaviour_(form,
    'Tandem bow questions do not appear for a Twin Block',
    'BEFORE: "Set tandem bow ___ mm" and the tandem occlusal options showed for both appliances.\n' +
    'NOW: they appear only for a Modified Tandem.\n\n' +
    'Does a Twin Block ever need a tandem bow measurement?');

  behaviour_(form,
    'The tandem diagram is hidden for a Twin Block',
    'There is a reference diagram captioned "MODIFIED TANDEM". It used to show even when a ' +
    'doctor had chosen Twin Block, which was misleading. It is now hidden for Twin Block.\n\n' +
    'If you have a Twin Block diagram we could show instead, say so below.');

  behaviour_(form,
    'Rush pricing appears whenever a doctor asks to rush — on any appliance',
    'BEFORE: the two rush-charge questions only appeared on orthodontic orders.\n' +
    'NOW: they appear whenever "rush this case" is ticked, for any appliance.\n\n' +
    'This one affects pricing, so it is worth a careful look. Should rush pricing be offered on ' +
    'every appliance, or orthodontics only?');

  behaviour_(form,
    'The logo upload appears only when a logo is requested (Sport-Guards)',
    'BEFORE: the "upload images for logo addition" box was always shown.\n' +
    'NOW: it appears when "Add logo" is ticked in the specifications table.');

  behaviour_(form,
    'Mandibular expansion options match the retention chosen',
    'BEFORE: both the removable and fixed expansion lists were always shown, even though each ' +
    'is labelled "Only".\n' +
    'NOW: the removable list shows for clasp or composite retention; the fixed list shows for ' +
    'banded or printed-band retention.\n\n' +
    'Is that the right split?');

  behaviour_(form,
    'Screws marked "Fixed ONLY" grey out when retention is removable',
    'A doctor could previously choose a removable retention and then pick an expansion screw ' +
    'marked "Fixed ONLY", which contradicts itself. Those options are now greyed out rather than ' +
    'hidden, so it is still clear they exist.\n\n' +
    'Is the same true in reverse for "Memory Screw (Removable Only)"?');

  behaviour_(form,
    'The opposing trutaine question no longer contradicts itself (Olmos Night)',
    'BEFORE: a doctor could answer "with / without anterior buildup" on the opposing trutaine, ' +
    'then separately tick "Upper arch ONLY (no opposing trutaine)".\n' +
    'NOW: the "upper arch only" question is asked first, and the trutaine question disappears if ' +
    'they choose it.');

  // ══ PART 3 — missing ═══════════════════════════════════════════════════
  form.addPageBreakItem()
    .setTitle('Part 3 — Two things we are missing');

  form.addParagraphTextItem()
    .setTitle('What should a doctor be asked in the NUVELO digital setup box?')
    .setHelpText(
      'It has four column headings — "Orient to HIP", "Add occlusal overlay to bite", ' +
      '"Occlusal coverage on teeth #\'s:", "Other" — but no rows, so there was nothing for a ' +
      'doctor to fill in. A single row has been added as a placeholder so it works at all, but ' +
      'we do not know what belongs there.'
    )
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Nightguards are asked about twice — should they become one question?')
    .setHelpText(
      'There is a device list (Dual Arch Slider / Dual Arch Flatplane / Single Arch Nightguard) ' +
      'and, just below it, a table of seven guards and splints. They overlap, and a doctor can ' +
      'answer both — which is also why three of the nightguard questions in Part 1 are unresolved.'
    )
    .setChoiceValues([
      'Yes — keep the device list, drop the table',
      'Yes — keep the table, drop the device list',
      'No — doctors use both, leave it',
      'Not sure — worth discussing'
    ])
    .showOtherOption(true)
    .setRequired(true);

  // ══ Close ══════════════════════════════════════════════════════════════
  form.addPageBreakItem().setTitle('Anything else');

  form.addParagraphTextItem()
    .setTitle('Anything wrong, or anything missing?')
    .setHelpText(
      'Including any of the 41 already-agreed mappings, if one looks wrong to you. The full list ' +
      'is in the document that came with this form.'
    );

  var sheet = SpreadsheetApp.create('Diamond Labs — prescription form answers');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());

  Logger.log('Send this to the lab:  %s', form.getPublishedUrl());
  Logger.log('Edit the form here:    %s', form.getEditUrl());
  Logger.log('Answers land here:     %s', sheet.getUrl());
}

/**
 * "Is this the right code?" — one question, with Other for a replacement code,
 * rather than two questions.
 */
function confirm_(form, title, help, proposedCode) {
  form.addMultipleChoiceItem()
    .setTitle(title)
    .setHelpText(help)
    .setChoiceValues([
      'Yes — ' + proposedCode + ' is right',
      'No — this should not be charged at all'
    ])
    .showOtherOption(true)
    .setRequired(true);
}

/** "Is this what you want to happen?" — yes, or tell us what it should do. */
function behaviour_(form, title, help) {
  form.addMultipleChoiceItem()
    .setTitle(title)
    .setHelpText(help)
    .setChoiceValues([
      'Yes — that is what we want',
      'No — it should work differently'
    ])
    .showOtherOption(true)
    .setRequired(true);
}
