import * as cheerio from 'cheerio';
import { convertDateToYYYYMMDD, parseTimeTo24Hour, parseDurationToMinutes } from '../utils/date-time-parsers';

export function extractFlights(body: string): any[] {
  const flights: any[] = [];
  if (!body || body.trim().length === 0) return [];
  
  try {
    const $ = cheerio.load(body);
    const searchModals = $('div.search_modal');
    if (searchModals.length === 0) return [];
    
    searchModals.each((index: number, element: cheerio.Element) => {
      const $searchModal = $(element);
      try {
        const flight = extractFlightFromSearchModal($, $searchModal);
        if (flight && flight.price) {
          flights.push(flight);
        }
      } catch (e) {
        // Skip this flight
      }
    });
  } catch (e) {
    // Return empty array
  }
  
  return flights;
}

function extractFlightFromSearchModal($: cheerio.CheerioAPI, $el: cheerio.Cheerio<cheerio.Element>): any {
  const headings = $el.find('p._heading');
  const outboundHeading = headings.filter((i: number, el: cheerio.Element) => {
    const text = $(el).text();
    return text.includes('Outbound') && !text.includes('Return') && !text.includes('Book Your Ticket');
  }).first();
  const returnHeading = headings.filter((i: number, el: cheerio.Element) => {
    const text = $(el).text();
    return text.includes('Return') && !text.includes('Book Your Ticket');
  }).first();
  
  const outboundFlight = extractFlightFromSection($, $el, outboundHeading, 'outbound');
  if (!outboundFlight) return null;
  
  let returnFlight = null;
  if (returnHeading.length > 0) {
    returnFlight = extractFlightFromSection($, $el, returnHeading, 'return');
  }
  
  const prices = extractPricesFromSimilar($, $el);
  const priceValues = prices
    .map(p => {
      const numValue = parseFloat(p.price.replace(/,/g, ''));
      return { ...p, numValue };
    })
    .sort((a, b) => a.numValue - b.numValue)
    .map(p => p.price);
  
  const price = priceValues.length > 0 ? priceValues[0] : null;
  if (!price) return null;
  
  return {
    date: outboundFlight.date,
    price,
    prices: prices.length > 0 ? prices : undefined,
    outbound: outboundFlight,
    return: returnFlight || undefined,
  };
}

function extractFlightFromSection($: cheerio.CheerioAPI, $el: cheerio.Cheerio<cheerio.Element>, heading: cheerio.Cheerio<cheerio.Element>, type: 'outbound' | 'return'): any {
  if (heading.length === 0) return null;
  
  const dateText = heading.text();
  const dateMatch = dateText.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(\d{4})/);
  const date = dateMatch ? `${dateMatch[2]} ${dateMatch[3]} ${dateMatch[4]}` : null;
  
  const panel = heading.nextAll('div._panel').first();
  if (panel.length === 0) return null;
  
  const panelHeading = panel.find('div._panel_heading').first();
  const airlineName = panelHeading.find('p._ahn').first().text().trim();
  const flightName = panelHeading.find('p._flight_name').first().text().trim();
  
  const tripSection = panelHeading.find('div.trip').first();
  const departureTimeEl = tripSection.find('p.time').first();
  const departureTime = departureTimeEl.clone().children().remove().end().text().trim();
  const departureAirport = departureTimeEl.find('span').first().text().trim();
  
  const arrivalTimeEl = tripSection.find('p.time').last();
  const arrivalTime = arrivalTimeEl.clone().children().remove().end().text().trim();
  const arrivalAirport = arrivalTimeEl.find('span').first().text().trim();
  
  const stopsSection = tripSection.find('div._stops').first();
  const totalDuration = stopsSection.find('p.time').first().text().trim();
  const stopCountText = stopsSection.find('p.stop').first().text().trim();
  const stopCountMatch = stopCountText.match(/(\d+)\s*stop/);
  const stopCount = stopCountMatch ? parseInt(stopCountMatch[1], 10) : 0;
  
  const legs: any[] = [];
  panel.find('div._panel_body').each((index: number, legElement: cheerio.Element) => {
    const $leg = $(legElement);
    const flightInfoText = $leg.find('div._head small').first().text().trim();
    const flightInfoParts = flightInfoText.split(/\s+/);
    const flightNumber = flightInfoParts.length > 0 ? flightInfoParts[flightInfoParts.length - 1] : null;
    const airlineNameLeg = flightInfoParts.length > 1 ? flightInfoParts.slice(0, -1).join(' ') : null;
    const legDuration = $leg.find('div.c1 p').first().text().trim();
    const timesEl = $leg.find('div.c3');
    const departureTimeLeg = timesEl.find('p').first().text().trim();
    const arrivalTimeLeg = timesEl.find('p').last().text().trim();
    const airportsEl = $leg.find('div.c4');
    const originAirportFull = airportsEl.find('p').first().text().trim();
    const destinationAirportFull = airportsEl.find('p').last().text().trim();
    const originCodeMatch = originAirportFull.match(/^([A-Z]{3})\s/);
    const destinationCodeMatch = destinationAirportFull.match(/^([A-Z]{3})\s/);
    const originCode = originCodeMatch ? originCodeMatch[1] : null;
    const destinationCode = destinationCodeMatch ? destinationCodeMatch[1] : null;
    const connectEl = $leg.find('p.connect_airport');
    const connectionTime = connectEl.length > 0 ? connectEl.find('span').first().text().trim() : null;
    const summaryEl = $leg.find('p._summary');
    let arrivalDateText = null;
    if (summaryEl.length > 0) {
      const summaryText = summaryEl.text();
      const dateMatch = summaryText.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(\d{4})/);
      if (dateMatch) {
        arrivalDateText = `${dateMatch[1]}, ${dateMatch[2]} ${dateMatch[3]} ${dateMatch[4]}`;
      }
    }
    
    if (departureTimeLeg && arrivalTimeLeg && originCode && destinationCode) {
      legs.push({
        flightNumber: flightNumber || null,
        airline: airlineNameLeg || null,
        departure: departureTimeLeg,
        arrival: arrivalTimeLeg,
        origin: originCode,
        destination: destinationCode,
        originFull: originAirportFull,
        destinationFull: destinationAirportFull,
        duration: legDuration || null,
        connectionTime: connectionTime || null,
        arrivalDate: arrivalDateText || null,
      });
    }
  });
  
  return {
    date,
    departure: departureTime,
    arrival: arrivalTime,
    origin: departureAirport,
    destination: arrivalAirport,
    duration: totalDuration,
    airline: airlineName || flightName || null,
    stopCount,
    legs: legs.length > 0 ? legs : undefined,
  };
}

function extractPricesFromSimilar($: cheerio.CheerioAPI, $el: cheerio.Cheerio<cheerio.Element>): Array<{ provider: string; price: string; link?: string }> {
  const prices: Array<{ provider: string; price: string; link?: string }> = [];
  $el.find('div._similar > div').each((index: number, priceElement: cheerio.Element) => {
    const $priceEl = $(priceElement);
    const providerName = $priceEl.find('p').first().text().trim();
    const priceP = $priceEl.find('p').eq(1);
    const priceText = priceP.text().trim();
    const fullLink = priceP.find('a').attr('href');
    let selectLink: string | undefined = undefined;
    if (fullLink) {
      const uIndex = fullLink.indexOf('u=');
      if (uIndex !== -1) {
        const uSubstring = fullLink.substring(uIndex + 2);
        const endIndex = uSubstring.indexOf('&');
        const uValue = endIndex !== -1 ? uSubstring.substring(0, endIndex) : uSubstring;
        try {
          selectLink = decodeURIComponent(uValue);
        } catch (e) {
          selectLink = uValue;
        }
      }
    }
    const priceMatch = priceText.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/);
    if (priceMatch) {
      prices.push({
        provider: providerName,
        price: priceMatch[1],
        link: selectLink
      });
    }
  });
  return prices;
}

