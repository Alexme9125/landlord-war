"""Keep layout failures actionable without relaxing the viewport assertion."""
import json
from pathlib import Path


def assert_no_overflow(page, artifact_prefix):
    dimensions = page.evaluate('''() => ({
        viewport: innerWidth,
        scroll: document.documentElement.scrollWidth
    })''')
    if dimensions['scroll'] <= dimensions['viewport']:
        return
    dimensions['elements'] = page.evaluate('''() =>
        [...document.querySelectorAll('body *')].map(element => ({
            tag: element.tagName,
            class: element.getAttribute('class'),
            text: (element.textContent || '').slice(0, 60),
            rect: element.getBoundingClientRect().toJSON()
        })).filter(element => element.rect.width > 0 &&
            (element.rect.right > innerWidth || element.rect.left < 0)).slice(0, 30)
    ''')
    prefix = Path(artifact_prefix)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(prefix) + '-overflow.png', full_page=True)
    details = json.dumps(dimensions, ensure_ascii=False, indent=2)
    Path(str(prefix) + '-overflow.json').write_text(details, encoding='utf-8')
    raise AssertionError(f'Horizontal overflow; artifacts: {prefix}\n{details}')
