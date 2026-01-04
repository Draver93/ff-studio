export function initHelp() {
	// Attach toggle behavior to help cards
	const attach = () => {
		document.querySelectorAll('.help-card').forEach(card => {
			const header = card.querySelector('.help-card-header');
			const body = card.querySelector('.help-card-body');
			if (!header || !body) return;
			// Ensure closed initial state
			header.setAttribute('aria-expanded', 'false');
			body.style.display = 'none';

			header.addEventListener('click', (e) => {
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
					// animate to 0 then hide after transition
					const height = body.scrollHeight;
					body.style.maxHeight = height + 'px';
					requestAnimationFrame(() => {
						body.style.maxHeight = '0px';
					});
					setTimeout(() => { body.style.display = 'none'; }, 320);
				}
			});
		});
	};

	// Initialize when DOM is ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', attach);
	} else {
		attach();
	}
}
