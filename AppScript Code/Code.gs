/**
 * ============================================================
 * AMAN — OPPORTUNITY DATABASE API
 * Production API v1.0
 * ============================================================
 *
 * Google Apps Script Web App
 * 
 * Purpose:
 *   Controlled database API for:
 *   AMAN — OPPORTUNITY DATABASE
 *
 * Supported operations:
 *
 * READ
 *   health
 *   get_settings
 *   find_opportunity
 *   find_company
 *   find_contact
 *
 * WRITE
 *   add_opportunity
 *   update_opportunity
 *   upsert_company
 *   upsert_contact
 *   record_search
 *   record_contact
 *
 * SECURITY
 *   - API key required for POST requests.
 *   - No delete endpoint.
 *   - No formatting endpoint.
 *   - No arbitrary spreadsheet/cell endpoint.
 *   - All writes use a script lock.
 *   - Required fields are validated.
 *   - Duplicate opportunity protection.
 *   - Company cooldown protection.
 *   - Contact verification protection.
 *
 * IMPORTANT:
 *   This API does NOT send Gmail.
 *   Gmail remains completely separate.
 *
 * ============================================================
 */


// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {

  // ----------------------------------------------------------
  // Your Google Spreadsheet ID
  // ----------------------------------------------------------
  SPREADSHEET_ID:
    'PASTE_YOUR_GOOGLE_SHEET_ID_HERE',


  // ----------------------------------------------------------
  // Exact sheet/tab names
  // ----------------------------------------------------------

  SHEETS: {
    OPPORTUNITIES: 'OPPORTUNITIES',
    COMPANIES: 'COMPANIES',
    CONTACTS: 'CONTACTS',
    SEARCH_HISTORY: 'SEARCH HISTORY',
    CONTACT_HISTORY: 'CONTACT HISTORY',
    SETTINGS: 'SETTINGS'
  },


  // ----------------------------------------------------------
  // Script Properties
  // ----------------------------------------------------------

  API_SECRET_PROPERTY:
    'API_SECRET',


  // ----------------------------------------------------------
  // System rules
  // ----------------------------------------------------------

  MIN_MATCH_SCORE:
    75,

  TYPE_B_COOLDOWN_DAYS:
    60,

  TYPE_C_COOLDOWN_DAYS:
    90,


  // ----------------------------------------------------------
  // Valid opportunity types
  // ----------------------------------------------------------

  OPPORTUNITY_TYPES: [
    'Type A',
    'Type B',
    'Type C'
  ],


  // ----------------------------------------------------------
  // Valid work arrangements
  // ----------------------------------------------------------

  WORK_ARRANGEMENTS: [
    'On-site',
    'Hybrid',
    'Remote',
    'UAE Remote',
    'Unknown'
  ],


  // ----------------------------------------------------------
  // Valid contact types
  // ----------------------------------------------------------

  CONTACT_TYPES: [
    'Named Recruiter',
    'Hiring Manager',
    'Technical/Department Lead',
    'Careers',
    'HR',
    'Generic Company Contact',
    'Other'
  ],


  // ----------------------------------------------------------
  // Valid result/status values are intentionally NOT
  // hard-coded because your Sheet is already live and
  // Grok may use controlled values defined in the profile.
  // ----------------------------------------------------------
};


// ============================================================
// HTTP ENTRY POINTS
// ============================================================


/**
 * GET
 *
 * Health check.
 *
 * Does not expose spreadsheet data.
 */
function doGet(e) {

  try {

    return jsonResponse_({
      ok: true,
      service:
        'AMAN — Opportunity Database API',
      version:
        '1.0.0',
      status:
        'healthy',
      timestamp:
        new Date().toISOString()
    });

  } catch (error) {

    return jsonResponse_({
      ok: false,
      error:
        error.message
    });
  }
}


/**
 * POST
 *
 * All database operations go through here.
 */
function doPost(e) {

  try {

    const request =
      parseRequest_(e);

    authenticate_(request);

    const action =
      String(request.action || '')
        .trim()
        .toLowerCase();

    if (!action) {
      throw new Error(
        'Missing required field: action.'
      );
    }


    switch (action) {


      // ======================================================
      // READ
      // ======================================================

      case 'health':

        return jsonResponse_({
          ok: true,
          service:
            'AMAN — Opportunity Database API',
          version:
            '1.0.0',
          status:
            'healthy',
          timestamp:
            new Date().toISOString()
        });


      case 'get_settings':

        return jsonResponse_(
          getSettings_()
        );


      case 'find_opportunity':

        return jsonResponse_(
          findOpportunity_(request)
        );


      case 'find_company':

        return jsonResponse_(
          findCompany_(request)
        );


      case 'find_contact':

        return jsonResponse_(
          findContact_(request)
        );


      // ======================================================
      // WRITE
      // ======================================================

      case 'add_opportunity':

        return jsonResponse_(
          addOpportunity_(request)
        );


      case 'update_opportunity':

        return jsonResponse_(
          updateOpportunity_(request)
        );


      case 'upsert_company':

        return jsonResponse_(
          upsertCompany_(request)
        );


      case 'upsert_contact':

        return jsonResponse_(
          upsertContact_(request)
        );


      case 'record_search':

        return jsonResponse_(
          recordSearch_(request)
        );


      case 'record_contact':

        return jsonResponse_(
          recordContact_(request)
        );


      default:

        throw new Error(
          'Unknown or unauthorized action: ' +
          action
        );
    }


  } catch (error) {

    console.error(error);

    return jsonResponse_({
      ok: false,
      error:
        error.message
    });
  }
}


// ============================================================
// AUTHENTICATION
// ============================================================


function authenticate_(request) {

  const expected =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        CONFIG.API_SECRET_PROPERTY
      );


  if (!expected) {

    throw new Error(
      'API_SECRET is not configured.'
    );
  }


  const provided =
    String(
      request.apiKey || ''
    );


  if (
    !provided ||
    provided !== expected
  ) {

    throw new Error(
      'Unauthorized request.'
    );
  }
}


// ============================================================
// DATABASE ACCESS
// ============================================================


function getDatabase_() {

  if (
    !CONFIG.SPREADSHEET_ID ||
    CONFIG.SPREADSHEET_ID ===
      'PASTE_YOUR_GOOGLE_SHEET_ID_HERE'
  ) {

    throw new Error(
      'SPREADSHEET_ID is not configured.'
    );
  }


  return SpreadsheetApp
    .openById(
      CONFIG.SPREADSHEET_ID
    );
}


function getSheet_(sheetName) {

  const ss =
    getDatabase_();

  const sheet =
    ss.getSheetByName(
      sheetName
    );


  if (!sheet) {

    throw new Error(
      'Sheet/tab not found: ' +
      sheetName
    );
  }


  return sheet;
}


// ============================================================
// REQUEST PARSING
// ============================================================


function parseRequest_(e) {

  if (!e) {

    throw new Error(
      'Missing request.'
    );
  }


  let body = {};


  if (
    e.postData &&
    e.postData.contents
  ) {

    const raw =
      String(
        e.postData.contents
      ).trim();


    if (raw) {

      try {

        body =
          JSON.parse(raw);

      } catch (error) {

        throw new Error(
          'POST body must be valid JSON.'
        );
      }
    }
  }


  // Support query parameters as well.
  if (e.parameter) {

    Object.keys(
      e.parameter
    ).forEach(function(key) {

      if (
        body[key] === undefined
      ) {

        body[key] =
          e.parameter[key];
      }

    });
  }


  return body;
}


// ============================================================
// HEADER / ROW HELPERS
// ============================================================


function getHeaders_(sheet) {

  const lastColumn =
    sheet.getLastColumn();


  if (
    lastColumn < 1
  ) {

    throw new Error(
      'Sheet has no columns.'
    );
  }


  return sheet
    .getRange(
      1,
      1,
      1,
      lastColumn
    )
    .getValues()[0];
}


function normalize_(value) {

  return String(
    value === null ||
    value === undefined
      ? ''
      : value
  )
    .trim()
    .toLowerCase();
}


function findColumn_(
  headers,
  columnName
) {

  const wanted =
    normalize_(
      columnName
    );


  for (
    let i = 0;
    i < headers.length;
    i++
  ) {

    if (
      normalize_(
        headers[i]
      ) === wanted
    ) {

      return i;
    }
  }


  return -1;
}


function requireColumn_(
  headers,
  columnName
) {

  const index =
    findColumn_(
      headers,
      columnName
    );


  if (index === -1) {

    throw new Error(
      'Required column not found: ' +
      columnName
    );
  }


  return index;
}


function setRowValue_(
  row,
  headers,
  columnName,
  value
) {

  const index =
    findColumn_(
      headers,
      columnName
    );


  if (index !== -1) {

    row[index] =
      sanitizeCellValue_(
        value
      );
  }
}


function setCell_(
  sheet,
  headers,
  rowNumber,
  columnName,
  value
) {

  const column =
    requireColumn_(
      headers,
      columnName
    );


  sheet
    .getRange(
      rowNumber,
      column + 1
    )
    .setValue(
      sanitizeCellValue_(
        value
      )
    );
}


function getCell_(
  sheet,
  headers,
  rowNumber,
  columnName
) {

  const column =
    requireColumn_(
      headers,
      columnName
    );


  return sheet
    .getRange(
      rowNumber,
      column + 1
    )
    .getValue();
}


/**
 * Prevent accidental spreadsheet formulas.
 */
function sanitizeCellValue_(value) {

  if (
    value === null ||
    value === undefined
  ) {

    return '';
  }


  if (
    typeof value === 'string' &&
    value.startsWith('=')
  ) {

    return "'" + value;
  }


  return value;
}


// ============================================================
// ROW FINDER
// ============================================================


function findRowByValue_(
  sheet,
  columnName,
  targetValue
) {

  const headers =
    getHeaders_(
      sheet
    );


  const column =
    requireColumn_(
      headers,
      columnName
    );


  const lastRow =
    sheet.getLastRow();


  if (lastRow < 2) {

    return -1;
  }


  const values =
    sheet
      .getRange(
        2,
        column + 1,
        lastRow - 1,
        1
      )
      .getValues();


  const wanted =
    normalize_(
      targetValue
    );


  for (
    let i = 0;
    i < values.length;
    i++
  ) {

    if (
      normalize_(
        values[i][0]
      ) === wanted
    ) {

      return i + 2;
    }
  }


  return -1;
}


// ============================================================
// OBJECT CONVERSION
// ============================================================


function rowToObject_(
  headers,
  row
) {

  const result = {};


  for (
    let i = 0;
    i < headers.length;
    i++
  ) {

    let value =
      row[i];


    // Dates must become strings in JSON.
    if (
      value instanceof Date
    ) {

      value =
        value.toISOString();
    }


    result[
      String(
        headers[i]
      )
    ] =
      value;
  }


  return result;
}


// ============================================================
// GET SETTINGS
// ============================================================


function getSettings_() {

  const sheet =
    getSheet_(
      CONFIG.SHEETS.SETTINGS
    );


  const lastRow =
    sheet.getLastRow();


  if (lastRow < 2) {

    return {
      ok: true,
      count: 0,
      settings: {}
    };
  }


  const values =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        2
      )
      .getValues();


  const settings = {};


  values.forEach(
    function(row) {

      const key =
        String(
          row[0] || ''
        ).trim();


      if (key) {

        settings[key] =
          row[1];
      }

    }
  );


  return {
    ok: true,
    count:
      Object.keys(
        settings
      ).length,
    settings:
      settings
  };
}


// ============================================================
// FIND OPPORTUNITY
// ============================================================


function findOpportunity_(
  request
) {

  const sheet =
    getSheet_(
      CONFIG.SHEETS.OPPORTUNITIES
    );


  const headers =
    getHeaders_(
      sheet
    );


  const lastRow =
    sheet.getLastRow();


  if (lastRow < 2) {

    return {
      ok: true,
      count: 0,
      matches: []
    };
  }


  const rows =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        headers.length
      )
      .getValues();


  const opportunityId =
    request.opportunityId;

  const jobUrl =
    request.jobUrl;

  const company =
    request.company;

  const jobTitle =
    request.jobTitle;


  const matches = [];


  rows.forEach(
    function(row, index) {

      const object =
        rowToObject_(
          headers,
          row
        );


      let matched =
        false;


      if (
        opportunityId &&
        normalize_(
          object[
            'Opportunity ID'
          ]
        ) ===
        normalize_(
          opportunityId
        )
      ) {

        matched = true;
      }


      if (
        !matched &&
        jobUrl &&
        normalize_(
          object[
            'Job URL'
          ]
        ) ===
        normalize_(
          jobUrl
        )
      ) {

        matched = true;
      }


      if (
        !matched &&
        company &&
        jobTitle &&
        normalize_(
          object[
            'Company'
          ]
        ) ===
        normalize_(
          company
        ) &&
        normalize_(
          object[
            'Job Title'
          ]
        ) ===
        normalize_(
          jobTitle
        )
      ) {

        matched = true;
      }


      if (matched) {

        object._row =
          index + 2;

        matches.push(
          object
        );
      }

    }
  );


  return {
    ok: true,
    count:
      matches.length,
    matches:
      matches
  };
}


// ============================================================
// FIND COMPANY
// ============================================================


function findCompany_(
  request
) {

  const sheet =
    getSheet_(
      CONFIG.SHEETS.COMPANIES
    );


  const headers =
    getHeaders_(
      sheet
    );


  const lastRow =
    sheet.getLastRow();


  if (lastRow < 2) {

    return {
      ok: true,
      count: 0,
      matches: []
    };
  }


  const rows =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        headers.length
      )
      .getValues();


  const wantedCompany =
    request.company;

  const wantedWebsite =
    request.website;


  if (
    !wantedCompany &&
    !wantedWebsite
  ) {

    throw new Error(
      'Provide company or website.'
    );
  }


  const matches = [];


  rows.forEach(
    function(row, index) {

      const object =
        rowToObject_(
          headers,
          row
        );


      const companyMatch =
        wantedCompany &&
        normalize_(
          object[
            'Company'
          ]
        ) ===
        normalize_(
          wantedCompany
        );


      const websiteMatch =
        wantedWebsite &&
        normalize_(
          object[
            'Website'
          ]
        ) ===
        normalize_(
          wantedWebsite
        );


      if (
        companyMatch ||
        websiteMatch
      ) {

        object._row =
          index + 2;

        matches.push(
          object
        );
      }

    }
  );


  return {
    ok: true,
    count:
      matches.length,
    matches:
      matches
  };
}


// ============================================================
// FIND CONTACT
// ============================================================


function findContact_(
  request
) {

  const sheet =
    getSheet_(
      CONFIG.SHEETS.CONTACTS
    );


  const headers =
    getHeaders_(
      sheet
    );


  const lastRow =
    sheet.getLastRow();


  if (lastRow < 2) {

    return {
      ok: true,
      count: 0,
      matches: []
    };
  }


  const rows =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        headers.length
      )
      .getValues();


  const wantedEmail =
    request.email;

  const wantedCompany =
    request.company;

  const wantedContact =
    request.contactName;


  if (
    !wantedEmail &&
    !wantedCompany &&
    !wantedContact
  ) {

    throw new Error(
      'Provide email, company, or contactName.'
    );
  }


  const matches = [];


  rows.forEach(
    function(row, index) {

      const object =
        rowToObject_(
          headers,
          row
        );


      let matched =
        false;


      if (
        wantedEmail &&
        normalize_(
          object[
            'Email'
          ]
        ) ===
        normalize_(
          wantedEmail
        )
      ) {

        matched = true;
      }


      if (
        !matched &&
        wantedCompany &&
        normalize_(
          object[
            'Company'
          ]
        ) ===
        normalize_(
          wantedCompany
        )
      ) {

        if (
          !wantedContact ||
          normalize_(
            object[
              'Contact Name'
            ]
          ) ===
          normalize_(
            wantedContact
          )
        ) {

          matched = true;
        }
      }


      if (matched) {

        object._row =
          index + 2;

        matches.push(
          object
        );
      }

    }
  );


  return {
    ok: true,
    count:
      matches.length,
    matches:
      matches
  };
}


// ============================================================
// ADD OPPORTUNITY
// ============================================================


function addOpportunity_(
  request
) {

  validateRequired_(
    request,
    [
      'opportunityId',
      'dateFound',
      'company',
      'opportunityType',
      'jobTitle',
      'location',
      'workArrangement',
      'jobUrl',
      'source',
      'matchScore'
    ]
  );


  const opportunityType =
    normalizeOpportunityType_(
      request.opportunityType
    );


  const matchScore =
    Number(
      request.matchScore
    );


  if (
    !Number.isFinite(
      matchScore
    )
  ) {

    throw new Error(
      'matchScore must be numeric.'
    );
  }


  if (
    matchScore <
    CONFIG.MIN_MATCH_SCORE
  ) {

    throw new Error(
      'Opportunity rejected: match score ' +
      matchScore +
      ' is below minimum score ' +
      CONFIG.MIN_MATCH_SCORE +
      '.'
    );
  }


  const lock =
    LockService.getScriptLock();


  lock.waitLock(
    15000
  );


  try {

    const sheet =
      getSheet_(
        CONFIG.SHEETS.OPPORTUNITIES
      );


    const headers =
      getHeaders_(
        sheet
      );


    // --------------------------------------------------------
    // Duplicate checks
    // --------------------------------------------------------

    const duplicate =
      findOpportunityInternal_(
        sheet,
        request
      );


    if (duplicate) {

      return {
        ok: true,
        result:
          'duplicate',
        opportunityId:
          duplicate[
            'Opportunity ID'
          ],
        row:
          duplicate._row,
        reason:
          'Existing opportunity matched by Opportunity ID, Job URL, or Company + Job Title.'
      };
    }


    // --------------------------------------------------------
    // Company cooldown
    // --------------------------------------------------------

    if (
      opportunityType ===
      'Type B' ||
      opportunityType ===
      'Type C'
    ) {

      const cooldown =
        getCompanyCooldown_(
          request.company,
          opportunityType
        );


      if (
        cooldown.blocked
      ) {

        return {
          ok: true,
          result:
            'blocked_cooldown',
          company:
            request.company,
          cooldownUntil:
            cooldown.cooldownUntil,
          reason:
            cooldown.reason
        };
      }
    }


    // --------------------------------------------------------
    // Contact rule
    // --------------------------------------------------------

    if (
      request.contactEmail
    ) {

      const contact =
        findVerifiedContactByEmail_(
          request.contactEmail
        );


      if (
        !contact
      ) {

        throw new Error(
          'Contact email is not verified in CONTACTS. ' +
          'Contact guessing is disabled.'
        );
      }
    }


    // --------------------------------------------------------
    // Build row
    // --------------------------------------------------------

    const row =
      new Array(
        headers.length
      ).fill('');


    setRowValue_(
      row,
      headers,
      'Opportunity ID',
      request.opportunityId
    );

    setRowValue_(
      row,
      headers,
      'Date Found',
      parseDateValue_(
        request.dateFound
      )
    );

    setRowValue_(
      row,
      headers,
      'Company',
      request.company
    );

    setRowValue_(
      row,
      headers,
      'Opportunity Type',
      opportunityType
    );

    setRowValue_(
      row,
      headers,
      'Job Title',
      request.jobTitle
    );

    setRowValue_(
      row,
      headers,
      'Location',
      request.location
    );

    setRowValue_(
      row,
      headers,
      'Work Arrangement',
      request.workArrangement
    );

    setRowValue_(
      row,
      headers,
      'Job URL',
      request.jobUrl
    );

    setRowValue_(
      row,
      headers,
      'Company URL',
      request.companyUrl
    );

    setRowValue_(
      row,
      headers,
      'Source',
      request.source
    );

    setRowValue_(
      row,
      headers,
      'Date Posted',
      parseDateValue_(
        request.datePosted
      )
    );

    setRowValue_(
      row,
      headers,
      'Contact Name',
      request.contactName
    );

    setRowValue_(
      row,
      headers,
      'Contact Role',
      request.contactRole
    );

    setRowValue_(
      row,
      headers,
      'Contact Email',
      request.contactEmail
    );

    setRowValue_(
      row,
      headers,
      'Resume Selected',
      request.resumeSelected
    );

    setRowValue_(
      row,
      headers,
      'Match Score',
      matchScore
    );

    setRowValue_(
      row,
      headers,
      'Technical Match',
      request.technicalMatch
    );

    setRowValue_(
      row,
      headers,
      'Experience Match',
      request.experienceMatch
    );

    setRowValue_(
      row,
      headers,
      'Location Match',
      request.locationMatch
    );

    setRowValue_(
      row,
      headers,
      'Industry Match',
      request.industryMatch
    );

    setRowValue_(
      row,
      headers,
      'Why Aman Fits',
      request.whyAmanFits
    );

    setRowValue_(
      row,
      headers,
      'Evidence',
      request.evidence
    );

    setRowValue_(
      row,
      headers,
      'Status',
      request.status ||
        'QUALIFIED'
    );

    setRowValue_(
      row,
      headers,
      'Draft Created',
      request.draftCreated ||
        'NO'
    );

    setRowValue_(
      row,
      headers,
      'Contacted',
      request.contacted ||
        'NO'
    );

    setRowValue_(
      row,
      headers,
      'Contact Date',
      parseDateValue_(
        request.contactDate
      )
    );

    setRowValue_(
      row,
      headers,
      'Cooldown Until',
      parseDateValue_(
        request.cooldownUntil
      )
    );

    setRowValue_(
      row,
      headers,
      'Notes',
      request.notes
    );


    // --------------------------------------------------------
    // Write
    // --------------------------------------------------------

    const targetRow =
      sheet.getLastRow() + 1;


    sheet
      .getRange(
        targetRow,
        1,
        1,
        row.length
      )
      .setValues([
        row
      ]);


    SpreadsheetApp.flush();


    // --------------------------------------------------------
    // Verify
    // --------------------------------------------------------

    const idColumn =
      requireColumn_(
        headers,
        'Opportunity ID'
      );


    const verifiedId =
      sheet
        .getRange(
          targetRow,
          idColumn + 1
        )
        .getValue();


    if (
      normalize_(
        verifiedId
      ) !==
      normalize_(
        request.opportunityId
      )
    ) {

      throw new Error(
        'Opportunity write verification failed.'
      );
    }


    return {
      ok: true,
      result:
        'created',
      opportunityId:
        request.opportunityId,
      row:
        targetRow,
      message:
        'Opportunity created and verified.'
    };


  } finally {

    lock.releaseLock();
  }
}


// ============================================================
// INTERNAL OPPORTUNITY DUPLICATE FINDER
// ============================================================


function findOpportunityInternal_(
  sheet,
  request
) {

  const headers =
    getHeaders_(
      sheet
    );


  const lastRow =
    sheet.getLastRow();


  if (lastRow < 2) {

    return null;
  }


  const rows =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        headers.length
      )
      .getValues();


  for (
    let i = 0;
    i < rows.length;
    i++
  ) {

    const object =
      rowToObject_(
        headers,
        rows[i]
      );


    const sameId =
      request.opportunityId &&
      normalize_(
        object[
          'Opportunity ID'
        ]
      ) ===
      normalize_(
        request.opportunityId
      );


    const sameUrl =
      request.jobUrl &&
      normalize_(
        object[
          'Job URL'
        ]
      ) ===
      normalize_(
        request.jobUrl
      );


    const sameCompanyJob =
      request.company &&
      request.jobTitle &&
      normalize_(
        object[
          'Company'
        ]
      ) ===
      normalize_(
        request.company
      ) &&
      normalize_(
        object[
          'Job Title'
        ]
      ) ===
      normalize_(
        request.jobTitle
      );


    if (
      sameId ||
      sameUrl ||
      sameCompanyJob
    ) {

      object._row =
        i + 2;

      return object;
    }
  }


  return null;
}


// ============================================================
// UPDATE OPPORTUNITY
// ============================================================


function updateOpportunity_(
  request
) {

  if (
    !request.opportunityId
  ) {

    throw new Error(
      'opportunityId is required.'
    );
  }


  const allowedFields = [

    'Date Found',
    'Company',
    'Opportunity Type',
    'Job Title',
    'Location',
    'Work Arrangement',
    'Job URL',
    'Company URL',
    'Source',
    'Date Posted',
    'Contact Name',
    'Contact Role',
    'Contact Email',
    'Resume Selected',
    'Match Score',
    'Technical Match',
    'Experience Match',
    'Location Match',
    'Industry Match',
    'Why Aman Fits',
    'Evidence',
    'Status',
    'Draft Created',
    'Contacted',
    'Contact Date',
    'Cooldown Until',
    'Notes'

  ];


  const fieldMap = {

    'dateFound':
      'Date Found',

    'company':
      'Company',

    'opportunityType':
      'Opportunity Type',

    'jobTitle':
      'Job Title',

    'location':
      'Location',

    'workArrangement':
      'Work Arrangement',

    'jobUrl':
      'Job URL',

    'companyUrl':
      'Company URL',

    'source':
      'Source',

    'datePosted':
      'Date Posted',

    'contactName':
      'Contact Name',

    'contactRole':
      'Contact Role',

    'contactEmail':
      'Contact Email',

    'resumeSelected':
      'Resume Selected',

    'matchScore':
      'Match Score',

    'technicalMatch':
      'Technical Match',

    'experienceMatch':
      'Experience Match',

    'locationMatch':
      'Location Match',

    'industryMatch':
      'Industry Match',

    'whyAmanFits':
      'Why Aman Fits',

    'evidence':
      'Evidence',

    'status':
      'Status',

    'draftCreated':
      'Draft Created',

    'contacted':
      'Contacted',

    'contactDate':
      'Contact Date',

    'cooldownUntil':
      'Cooldown Until',

    'notes':
      'Notes'
  };


  const sheet =
    getSheet_(
      CONFIG.SHEETS.OPPORTUNITIES
    );


  const headers =
    getHeaders_(
      sheet
    );


  const row =
    findRowByValue_(
      sheet,
      'Opportunity ID',
      request.opportunityId
    );


  if (row === -1) {

    throw new Error(
      'Opportunity not found: ' +
      request.opportunityId
    );
  }


  const lock =
    LockService.getScriptLock();


  lock.waitLock(
    15000
  );


  try {

    const updatedFields = [];


    Object.keys(
      fieldMap
    ).forEach(
      function(key) {

        if (
          request[key] ===
          undefined
        ) {

          return;
        }


        const columnName =
          fieldMap[key];


        if (
          allowedFields.indexOf(
            columnName
          ) === -1
        ) {

          return;
        }


        let value =
          request[key];


        if (
          [
            'Date Found',
            'Date Posted',
            'Contact Date',
            'Cooldown Until'
          ].indexOf(
            columnName
          ) !== -1
        ) {

          value =
            parseDateValue_(
              value
            );
        }


        setCell_(
          sheet,
          headers,
          row,
          columnName,
          value
        );


        updatedFields.push(
          columnName
        );

      }
    );


    SpreadsheetApp.flush();


    // Verify Opportunity ID still exists.
    const id =
      getCell_(
        sheet,
        headers,
        row,
        'Opportunity ID'
      );


    if (
      normalize_(
        id
      ) !==
      normalize_(
        request.opportunityId
      )
    ) {

      throw new Error(
        'Update verification failed.'
      );
    }


    return {
      ok: true,
      result:
        'updated',
      opportunityId:
        request.opportunityId,
      row:
        row,
      updatedFields:
        updatedFields,
      message:
        'Opportunity updated and verified.'
    };


  } finally {

    lock.releaseLock();
  }
}


// ============================================================
// COMPANY COOLDOWN
// ============================================================


function getCompanyCooldown_(
  company,
  opportunityType
) {

  const sheet =
    getSheet_(
      CONFIG.SHEETS.COMPANIES
    );


  const row =
    findRowByValue_(
      sheet,
      'Company',
      company
    );


  if (row === -1) {

    return {
      blocked: false
    };
  }


  const headers =
    getHeaders_(
      sheet
    );


  const cooldownUntil =
    getCell_(
      sheet,
      headers,
      row,
      'Cooldown Until'
    );


  if (
    !cooldownUntil
  ) {

    return {
      blocked: false
    };
  }


  const cooldownDate =
    parseDateValue_(
      cooldownUntil
    );


  if (
    !cooldownDate
  ) {

    return {
      blocked: false
    };
  }


  const now =
    new Date();


  if (
    cooldownDate <=
    now
  ) {

    return {
      blocked: false
    };
  }


  return {
    blocked: true,
    cooldownUntil:
      cooldownDate.toISOString(),
    reason:
      'Company is currently on cooldown for ' +
      opportunityType +
      '.'
  };
}


// ============================================================
// COMPANY UPSERT
// ============================================================


function upsertCompany_(
  request
) {

  if (
    !request.company
  ) {

    throw new Error(
      'company is required.'
    );
  }


  const sheet =
    getSheet_(
      CONFIG.SHEETS.COMPANIES
    );


  const lock =
    LockService.getScriptLock();


  lock.waitLock(
    15000
  );


  try {

    const headers =
      getHeaders_(
        sheet
      );


    let row =
      findRowByValue_(
        sheet,
        'Company',
        request.company
      );


    const fields = {

      'Website':
        request.website,

      'Industry':
        request.industry,

      'UAE Locations':
        request.uaeLocations,

      'Company Type':
        request.companyType,

      'Contacted Before':
        request.contactedBefore,

      'Last Contact Date':
        parseDateValue_(
          request.lastContactDate
        ),

      'Cooldown Until':
        parseDateValue_(
          request.cooldownUntil
        ),

      'Response':
        request.response,

      'Relationship Status':
        request.relationshipStatus,

      'Notes':
        request.notes
    };


    if (
      row === -1
    ) {

      row =
        sheet.getLastRow() + 1;


      const newRow =
        new Array(
          headers.length
        ).fill('');


      setRowValue_(
        newRow,
        headers,
        'Company',
        request.company
      );


      Object.keys(
        fields
      ).forEach(
        function(column) {

          if (
            fields[column] !==
            undefined
          ) {

            setRowValue_(
              newRow,
              headers,
              column,
              fields[column]
            );
          }

        }
      );


      sheet
        .getRange(
          row,
          1,
          1,
          newRow.length
        )
        .setValues([
          newRow
        ]);


      SpreadsheetApp.flush();


      return {
        ok: true,
        result:
          'created',
        company:
          request.company,
        row:
          row
      };
    }


    Object.keys(
      fields
    ).forEach(
      function(column) {

        if (
          fields[column] !==
          undefined
        ) {

          setCell_(
            sheet,
            headers,
            row,
            column,
            fields[column]
          );
        }

      }
    );


    SpreadsheetApp.flush();


    return {
      ok: true,
      result:
        'updated',
      company:
        request.company,
      row:
        row
    };


  } finally {

    lock.releaseLock();
  }
}


// ============================================================
// VERIFIED CONTACT LOOKUP
// ============================================================


function findVerifiedContactByEmail_(
  email
) {

  const sheet =
    getSheet_(
      CONFIG.SHEETS.CONTACTS
    );


  const row =
    findRowByValue_(
      sheet,
      'Email',
      email
    );


  if (
    row === -1
  ) {

    return null;
  }


  const headers =
    getHeaders_(
      sheet
    );


  const verificationUrl =
    getCell_(
      sheet,
      headers,
      row,
      'Verification URL'
    );


  const dateVerified =
    getCell_(
      sheet,
      headers,
      row,
      'Date Verified'
    );


  /*
   * We consider a contact verified only when
   * the record contains BOTH:
   *
   *   Verification URL
   *   Date Verified
   *
   * This prevents guessed/unverified addresses
   * from becoming outreach contacts.
   */

  if (
    !verificationUrl ||
    !dateVerified
  ) {

    return null;
  }


  return {
    row:
      row,
    email:
      email,
    verificationUrl:
      verificationUrl,
    dateVerified:
      dateVerified instanceof Date
        ? dateVerified.toISOString()
        : String(
            dateVerified
          )
  };
}


// ============================================================
// CONTACT UPSERT
// ============================================================


function upsertContact_(
  request
) {

  validateRequired_(
    request,
    [
      'company',
      'contactName',
      'email',
      'source',
      'verificationUrl',
      'contactType',
      'dateVerified'
    ]
  );


  const contactType =
    String(
      request.contactType
    ).trim();


  if (
    CONFIG.CONTACT_TYPES.indexOf(
      contactType
    ) === -1
  ) {

    throw new Error(
      'Invalid contactType: ' +
      contactType
    );
  }


  const sheet =
    getSheet_(
      CONFIG.SHEETS.CONTACTS
    );


  const lock =
    LockService.getScriptLock();


  lock.waitLock(
    15000
  );


  try {

    const headers =
      getHeaders_(
        sheet
      );


    let row =
      findRowByValue_(
        sheet,
        'Email',
        request.email
      );


    const fields = {

      'Company':
        request.company,

      'Contact Name':
        request.contactName,

      'Position':
        request.position,

      'Email':
        request.email,

      'Source':
        request.source,

      'Verification URL':
        request.verificationUrl,

      'Contact Type':
        contactType,

      'Date Verified':
        parseDateValue_(
          request.dateVerified
        ),

      'Notes':
        request.notes
    };


    if (
      row === -1
    ) {

      row =
        sheet.getLastRow() + 1;


      const newRow =
        new Array(
          headers.length
        ).fill('');


      Object.keys(
        fields
      ).forEach(
        function(column) {

          setRowValue_(
            newRow,
            headers,
            column,
            fields[column]
          );

        }
      );


      sheet
        .getRange(
          row,
          1,
          1,
          newRow.length
        )
        .setValues([
          newRow
        ]);


      SpreadsheetApp.flush();


      return {
        ok: true,
        result:
          'created',
        email:
          request.email,
        row:
          row,
        verified:
          true
      };
    }


    Object.keys(
      fields
    ).forEach(
      function(column) {

        setCell_(
          sheet,
          headers,
          row,
          column,
          fields[column]
        );

      }
    );


    SpreadsheetApp.flush();


    return {
      ok: true,
      result:
        'updated',
      email:
        request.email,
      row:
        row,
      verified:
        true
    };


  } finally {

    lock.releaseLock();
  }
}


// ============================================================
// SEARCH HISTORY
// ============================================================


function recordSearch_(
  request
) {

  validateRequired_(
    request,
    [
      'date',
      'searchCategory',
      'result'
    ]
  );


  const sheet =
    getSheet_(
      CONFIG.SHEETS.SEARCH_HISTORY
    );


  const lock =
    LockService.getScriptLock();


  lock.waitLock(
    15000
  );


  try {

    const headers =
      getHeaders_(
        sheet
      );


    const row =
      new Array(
        headers.length
      ).fill('');


    setRowValue_(
      row,
      headers,
      'Date',
      parseDateValue_(
        request.date
      )
    );

    setRowValue_(
      row,
      headers,
      'Company',
      request.company
    );

    setRowValue_(
      row,
      headers,
      'Job',
      request.job
    );

    setRowValue_(
      row,
      headers,
      'URL',
      request.url
    );

    setRowValue_(
      row,
      headers,
      'Search Category',
      request.searchCategory
    );

    setRowValue_(
      row,
      headers,
      'Result',
      request.result
    );

    setRowValue_(
      row,
      headers,
      'Reason Rejected',
      request.reasonRejected
    );

    setRowValue_(
      row,
      headers,
      'Duplicate Of',
      request.duplicateOf
    );

    setRowValue_(
      row,
      headers,
      'Notes',
      request.notes
    );


    const targetRow =
      sheet.getLastRow() + 1;


    sheet
      .getRange(
        targetRow,
        1,
        1,
        row.length
      )
      .setValues([
        row
      ]);


    SpreadsheetApp.flush();


    return {
      ok: true,
      result:
        'recorded',
      row:
        targetRow
    };


  } finally {

    lock.releaseLock();
  }
}


// ============================================================
// CONTACT HISTORY
// ============================================================


function recordContact_(
  request
) {

  validateRequired_(
    request,
    [
      'company',
      'contact',
      'email',
      'opportunity',
      'emailType'
    ]
  );


  const sheet =
    getSheet_(
      CONFIG.SHEETS.CONTACT_HISTORY
    );


  const lock =
    LockService.getScriptLock();


  lock.waitLock(
    15000
  );


  try {

    const headers =
      getHeaders_(
        sheet
      );


    const row =
      new Array(
        headers.length
      ).fill('');


    setRowValue_(
      row,
      headers,
      'Company',
      request.company
    );

    setRowValue_(
      row,
      headers,
      'Contact',
      request.contact
    );

    setRowValue_(
      row,
      headers,
      'Email',
      request.email
    );

    setRowValue_(
      row,
      headers,
      'Opportunity',
      request.opportunity
    );

    setRowValue_(
      row,
      headers,
      'Email Type',
      request.emailType
    );

    setRowValue_(
      row,
      headers,
      'Date Sent',
      parseDateValue_(
        request.dateSent
      )
    );

    setRowValue_(
      row,
      headers,
      'Response',
      request.response
    );

    setRowValue_(
      row,
      headers,
      'Follow-up Date',
      parseDateValue_(
        request.followUpDate
      )
    );

    setRowValue_(
      row,
      headers,
      'Result',
      request.result
    );

    setRowValue_(
      row,
      headers,
      'Notes',
      request.notes
    );


    const targetRow =
      sheet.getLastRow() + 1;


    sheet
      .getRange(
        targetRow,
        1,
        1,
        row.length
      )
      .setValues([
        row
      ]);


    SpreadsheetApp.flush();


    return {
      ok: true,
      result:
        'recorded',
      row:
        targetRow
    };


  } finally {

    lock.releaseLock();
  }
}


// ============================================================
// VALIDATION
// ============================================================


function validateRequired_(
  request,
  fields
) {

  fields.forEach(
    function(field) {

      const value =
        request[field];


      if (
        value ===
        undefined ||
        value ===
        null ||
        String(value).trim() === ''
      ) {

        throw new Error(
          'Missing required field: ' +
          field
        );
      }

    }
  );
}


function normalizeOpportunityType_(
  value
) {

  const raw =
    String(
      value || ''
    ).trim();


  const normalized =
    raw.toLowerCase();


  if (
    normalized ===
    'type a' ||
    normalized ===
    'a'
  ) {

    return 'Type A';
  }


  if (
    normalized ===
    'type b' ||
    normalized ===
    'b'
  ) {

    return 'Type B';
  }


  if (
    normalized ===
    'type c' ||
    normalized ===
    'c'
  ) {

    return 'Type C';
  }


  throw new Error(
    'opportunityType must be Type A, Type B, or Type C.'
  );
}


// ============================================================
// DATE HANDLING
// ============================================================


function parseDateValue_(
  value
) {

  if (
    value ===
    undefined ||
    value ===
    null ||
    value === ''
  ) {

    return '';
  }


  if (
    value instanceof Date
  ) {

    return value;
  }


  const date =
    new Date(
      value
    );


  if (
    isNaN(
      date.getTime()
    )
  ) {

    throw new Error(
      'Invalid date value: ' +
      value
    );
  }


  return date;
}


// ============================================================
// JSON RESPONSE
// ============================================================


function jsonResponse_(
  data
) {

  return ContentService
    .createTextOutput(
      JSON.stringify(
        data
      )
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );
}