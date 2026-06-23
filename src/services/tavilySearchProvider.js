const config = require('../config');

class TavilySearchError extends Error {
  constructor(message, code = 'TAVILY_SEARCH_FAILED', status = null) {
    super(message);
    this.name = 'TavilySearchError';
    this.code = code;
    this.status = status;
  }
}

function maskApiKey(value = '') {
  if (!value) return '';
  return `${String(value).slice(0, 6)}***`;
}

function tavilyOptions(overrides = {}) {
  return {
    apiKey: overrides.apiKey || config.search.apiKey || '',
    searchDepth: overrides.searchDepth || config.search.tavily.searchDepth || 'basic',
    maxResults: Number(overrides.maxResults || config.search.tavily.maxResultsPerQuery || 5),
    includeAnswer: Boolean(overrides.includeAnswer ?? config.search.tavily.includeAnswer),
    includeRawContent: Boolean(overrides.includeRawContent ?? config.search.tavily.includeRawContent),
    includeImages: Boolean(overrides.includeImages ?? config.search.tavily.includeImages),
    timeoutMs: Number(overrides.timeoutMs || config.search.tavily.timeoutMs || 15000)
  };
}

function normalizeTavilyResult(item = {}) {
  return {
    title: item.title || '',
    url: item.url || '',
    content: item.content || item.snippet || '',
    score: Number(item.score || 0),
    source_provider: 'tavily',
    raw: item
  };
}

async function searchTavily(query, options = {}) {
  const merged = tavilyOptions(options);
  if (!merged.apiKey) {
    throw new TavilySearchError('Tavily API Key is missing', 'TAVILY_API_KEY_MISSING');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), merged.timeoutMs);
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${merged.apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        query,
        search_depth: merged.searchDepth,
        max_results: merged.maxResults,
        include_answer: merged.includeAnswer,
        include_raw_content: merged.includeRawContent,
        include_images: merged.includeImages
      })
    });

    if (response.status === 401 || response.status === 403) {
      throw new TavilySearchError('API key invalid or unauthorized', 'TAVILY_UNAUTHORIZED', response.status);
    }
    if (response.status === 429) {
      throw new TavilySearchError('rate limited', 'TAVILY_RATE_LIMITED', response.status);
    }
    if (!response.ok) {
      throw new TavilySearchError(`Tavily request failed: ${response.status}`, 'TAVILY_REQUEST_FAILED', response.status);
    }

    const json = await response.json();
    return (json.results || []).map(normalizeTavilyResult);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new TavilySearchError('request timeout', 'TAVILY_TIMEOUT');
    }
    if (error instanceof TavilySearchError) throw error;
    throw new TavilySearchError(error.message || 'Tavily request failed', 'TAVILY_REQUEST_FAILED');
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { TavilySearchError, searchTavily, maskApiKey, normalizeTavilyResult };
