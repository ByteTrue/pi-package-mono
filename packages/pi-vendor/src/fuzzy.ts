/**
 * Fuzzy matching utilities for model ID search.
 * Matches if all query characters appear in order (not necessarily consecutive).
 * Lower score = better match.
 */

export type FuzzyMatch = {
	matches: boolean;
	score: number;
};

export function fuzzyMatch(query: string, text: string): FuzzyMatch {
	const queryLower = query.toLowerCase();
	const textLower = text.toLowerCase();

	const matchQuery = (normalizedQuery: string): FuzzyMatch => {
		if (normalizedQuery.length === 0) {
			return { matches: true, score: 0 };
		}
		if (normalizedQuery.length > textLower.length) {
			return { matches: false, score: 0 };
		}

		let queryIndex = 0;
		let score = 0;
		let lastMatchIndex = -1;
		let consecutiveMatches = 0;

		for (let i = 0; i < textLower.length && queryIndex < normalizedQuery.length; i++) {
			if (textLower[i] === normalizedQuery[queryIndex]) {
				const isWordBoundary = i === 0 || /[\s\-_./:]/.test(textLower[i - 1]!);

				// Reward consecutive matches
				if (lastMatchIndex === i - 1) {
					consecutiveMatches++;
					score -= consecutiveMatches * 5;
				} else {
					consecutiveMatches = 0;
					// Penalize gaps
					if (lastMatchIndex >= 0) {
						score += (i - lastMatchIndex - 1) * 2;
					}
				}

				// Reward word boundary matches
				if (isWordBoundary) {
					score -= 10;
				}

				// Slight penalty for later matches
				score += i * 0.1;
				lastMatchIndex = i;
				queryIndex++;
			}
		}

		if (queryIndex < normalizedQuery.length) {
			return { matches: false, score: 0 };
		}

		// Bonus for exact match
		if (normalizedQuery === textLower) {
			score -= 100;
		}

		return { matches: true, score };
	};

	const primaryMatch = matchQuery(queryLower);
	if (primaryMatch.matches) {
		return primaryMatch;
	}

	// Handle swapped alphanumeric patterns (e.g., "gpt4" vs "4gpt")
	const alphaNumericMatch = queryLower.match(/^(?<letters>[a-z]+)(?<digits>[0-9]+)$/);
	const numericAlphaMatch = queryLower.match(/^(?<digits>[0-9]+)(?<letters>[a-z]+)$/);

	const swappedQuery = alphaNumericMatch
		? `${alphaNumericMatch.groups?.digits ?? ""}${alphaNumericMatch.groups?.letters ?? ""}`
		: numericAlphaMatch
			? `${numericAlphaMatch.groups?.letters ?? ""}${numericAlphaMatch.groups?.digits ?? ""}`
			: "";

	if (!swappedQuery) {
		return primaryMatch;
	}

	const swappedMatch = matchQuery(swappedQuery);
	if (!swappedMatch.matches) {
		return primaryMatch;
	}

	return { matches: true, score: swappedMatch.score + 5 };
}

export type FuzzyResult<T> = {
	item: T;
	score: number;
};

export function fuzzyFilter<T>(items: T[], query: string, getText: (item: T) => string): T[] {
	if (!query.trim()) {
		return items;
	}

	const tokens = query
		.trim()
		.split(/[\s/]+/)
		.filter((t) => t.length > 0);

	if (tokens.length === 0) {
		return items;
	}

	const results: FuzzyResult<T>[] = [];

	for (const item of items) {
		const text = getText(item);
		let totalScore = 0;
		let allMatch = true;

		for (const token of tokens) {
			const match = fuzzyMatch(token, text);
			if (match.matches) {
				totalScore += match.score;
			} else {
				allMatch = false;
				break;
			}
		}

		if (allMatch) {
			results.push({ item, score: totalScore });
		}
	}

	results.sort((a, b) => a.score - b.score);
	return results.map((r) => r.item);
}
