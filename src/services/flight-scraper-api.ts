// API request functions for flight scraper

export async function getRequest(params: { originplace?: string; destinationplace?: string; outbounddate?: string; inbounddate?: string }) {
  const originplace = params.originplace || 'SLP';
  const destinationplace = params.destinationplace || 'BER';
  const outbounddate = params.outbounddate || '2026-01-19';
  const inbounddate = params.inbounddate || '';
  
  const queryParams = new URLSearchParams({
    originplace,
    destinationplace,
    outbounddate,
    inbounddate,
    cabinclass: 'Economy',
    adults: '1',
    children: '0',
    infants: '0',
    currency: 'EUR'
  });
  
  const url = `https://www.flightsfinder.com/portal/sky?${queryParams.toString()}`;
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Connection': 'keep-alive',
  };
  
  try {
    const response = await fetch(url, { method: 'GET', headers });
    const result = await response.text();
    const setCookieHeader = response.headers.get('set-cookie');
    let cookies = '';
    if (setCookieHeader) {
      const cookieArray = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
      cookies = cookieArray.map(cookie => cookie.split(';')[0].trim()).join('; ');
    }
    
    let dataObject: any = null;
    const dataIndex = result.indexOf('data:');
    if (dataIndex !== -1) {
      let braceStart = result.indexOf('{', dataIndex);
      if (braceStart !== -1) {
        let braceCount = 0;
        let braceEnd = -1;
        for (let i = braceStart; i < result.length; i++) {
          if (result[i] === '{') braceCount++;
          else if (result[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              braceEnd = i;
              break;
            }
          }
        }
        if (braceEnd !== -1) {
          const dataString = result.substring(braceStart, braceEnd + 1);
          try {
            const timestamp = Date.now();
            let processedString = dataString.replace(/\$\.now\(\)/g, timestamp.toString());
            processedString = processedString.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"');
            dataObject = JSON.parse(processedString);
          } catch (e) {
            try {
              const timestamp = Date.now();
              let processedString = dataString.replace(/\$\.now\(\)/g, timestamp.toString());
              dataObject = new Function('return ' + processedString)();
            } catch (evalError) {
              dataObject = null;
            }
          }
        }
      }
    }
    
    return { status: response.status, body: result, cookies, data: dataObject, url, success: true };
  } catch (error) {
    return { status: 0, statusText: 'Error', body: error instanceof Error ? error.message : 'Unknown error', cookies: '', data: null, success: false };
  }
}

export async function pollRequest(data: any, cookies: string = '', extractFlights: (body: string) => any[]): Promise<{ status: number; finished: boolean; count: number; flights: any[]; cookies: string; success: boolean }> {
  const url = 'https://www.flightsfinder.com/portal/sky/poll';
  const headers: { [key: string]: string } = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Connection': 'keep-alive',
  };
  if (cookies) headers['cookie'] = cookies;
  
  if (!data || !data['_token']) {
    throw new Error('Invalid data object: _token is required');
  }
  
  const dataWithUpdatedNoc = { ...data };
  dataWithUpdatedNoc['noc'] = Date.now().toString();
  const requestBody = Object.entries(dataWithUpdatedNoc)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
  
  try {
    const response = await fetch(url, { method: 'POST', headers, body: requestBody });
    const responseText = await response.text();
    
    if (response.status === 504 || responseText.includes('504 Gateway Time-out')) {
      return { status: response.status, finished: false, count: 0, flights: [], cookies, success: true };
    }
    
    const parts = responseText.split('|');
    const finished = parts.length > 0 && parts[0] === 'Y';
    const count = parts.length > 1 ? parseInt(parts[1], 10) || 0 : 0;
    let body = parts.length > 6 ? parts[6] : '';
    if (body && body.includes('%')) {
      try {
        body = decodeURIComponent(body);
      } catch (e) {
        // Use original body
      }
    }
    
    let flights: any[] = [];
    if (finished) {
      flights = extractFlights(body);
    }
    
    return { status: response.status, finished, count, flights, cookies, success: true };
  } catch (error) {
    return { status: 0, finished: false, count: 0, flights: [], cookies, success: false };
  }
}

