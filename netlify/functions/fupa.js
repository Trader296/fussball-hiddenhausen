const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9',
        'Cache-Control': 'no-cache',
      }
    };
    https.get(url, options, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

function parseTabelle(html) {
  const rows = [];
  // FuPa table rows contain team data
  const tableMatch = html.match(/<table[^>]*class="[^"]*table[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return null;
  const tableHtml = tableMatch[1];
  const rowMatches = tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const row of rowMatches) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c =>
      c[1].replace(/<[^>]+>/g, '').trim()
    );
    if (cells.length >= 5 && cells[0].match(/^\d+$/)) {
      rows.push({
        platz: cells[0],
        verein: cells[1],
        spiele: cells[2],
        punkte: cells[cells.length - 1],
        raw: cells
      });
    }
  }
  return rows;
}

function parseSpiele(html) {
  // Extract __NEXT_DATA__ JSON from FuPa's Next.js page
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    const json = JSON.parse(match[1]);
    // Navigate to matches data
    const props = json?.props?.pageProps;
    if (!props) return null;
    
    // Try different paths
    const matchData = props?.matches || props?.matchData || props?.data?.matches;
    if (matchData && Array.isArray(matchData)) {
      return matchData.slice(0, 20).map(m => ({
        datum: m.date || m.matchDate || '',
        heim: m.homeTeam?.name || m.home?.name || '?',
        gast: m.guestTeam?.name || m.guest?.name || '?',
        ergebnis: m.result || (m.goalsHome !== undefined ? `${m.goalsHome}:${m.goalsGuest}` : '-:-'),
      }));
    }
    return null;
  } catch(e) {
    return null;
  }
}

exports.handler = async function(event) {
  const type = event.queryStringParameters?.type || 'tabelle';
  
  const urls = {
    tabelle: 'https://www.fupa.net/league/bezirksliga-westfalen-staffel-1/table',
    spiele:  'https://www.fupa.net/league/bezirksliga-westfalen-staffel-1/matches',
    verein:  'https://www.fupa.net/club/spvg-hiddenhausen',
  };
  
  const url = urls[type] || urls.tabelle;
  
  try {
    const { status, body } = await httpsGet(url);
    
    let result = { ok: false, type, url, status, data: null, raw_length: body.length };
    
    // Try to extract __NEXT_DATA__
    const nextDataMatch = body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        result.ok = true;
        result.nextData = nextData;
      } catch(e) {
        result.parseError = e.message;
      }
    }
    
    // Also try HTML table parsing
    result.tableRows = parseTabelle(body);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=900'
      },
      body: JSON.stringify(result)
    };
  } catch(e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: false, error: e.message })
    };
  }
};
