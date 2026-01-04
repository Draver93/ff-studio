export function initHelp() {
	// Load help cards fragment and attach toggle behavior

	const attach = () => {
		document.querySelectorAll('.help-card').forEach(card => {
			const header = card.querySelector('.help-card-header');
			const body = card.querySelector('.help-card-body');
			if (!header || !body) return;
			// Ensure closed initial state
			header.setAttribute('aria-expanded', 'false');
			body.style.display = 'none';

			header.addEventListener('click', () => {
				const expanded = header.getAttribute('aria-expanded') === 'true';
				if (!expanded) {
					// Open
					card.classList.add('open');
					header.setAttribute('aria-expanded', 'true');
					body.style.display = 'flex';
					const height = body.scrollHeight;
					body.style.maxHeight = height + 'px';
				} else {
					// Close
					card.classList.remove('open');
					header.setAttribute('aria-expanded', 'false');
					const height = body.scrollHeight;
					body.style.maxHeight = height + 'px';
					requestAnimationFrame(() => { body.style.maxHeight = '0px'; });
					body.addEventListener('transitionend', function handler(e) {
						if (e.propertyName === 'max-height') {
							body.style.display = 'none';
							body.removeEventListener('transitionend', handler);
						}
					});
				}
			});
		});
	};

	const loadCards = async () => {
		const container = document.getElementById('help-list');
		if (!container) return;
		try {
			const res = await fetch('modules/help/help-cards.html');
			if (!res.ok) throw new Error('Failed to load help cards');
			const html = await res.text();
			container.innerHTML = html;
			attach();
		} catch (err) {
			console.warn('Help cards could not be loaded:', err);
		}
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', loadCards);
	} else {
		loadCards();
	}
}
