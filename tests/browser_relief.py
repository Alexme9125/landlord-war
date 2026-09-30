"""Real relief requests from a zero-balance account seeded in an isolated test database."""
import json
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('GAME_URL', 'http://127.0.0.1:3183')
OUT = Path(os.environ.get('SCREENSHOT_DIR', '/tmp/landlord-screenshots'))
OUT.mkdir(parents=True, exist_ok=True)
fixture = json.loads(Path(os.environ['RELIEF_FIXTURE']).read_text())

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width':320, 'height':780}, reduced_motion='reduce')
    context.add_cookies([{'name':'clear_session', 'value':fixture['token'], 'url':BASE, 'httpOnly':True, 'sameSite':'Lax'}])
    page, sibling = context.new_page(), context.new_page()
    errors = []
    for tab in [page, sibling]:
        tab.on('pageerror', lambda e: errors.append(str(e)))
        tab.goto(BASE)
        expect(tab.locator('.wallet')).to_have_attribute('title', '0 Tokens')
    page.locator('.wallet').click()
    dialog = page.get_by_role('dialog', name='再来一手', exact=True)
    expect(dialog).to_be_visible()
    for attempt in range(2):
        question = dialog.locator('.arithmetic').inner_text()
        dialog.get_by_label('算术题答案').fill('-1')
        dialog.get_by_role('button', name='领取 10 KTokens', exact=True).click()
        expect(dialog.get_by_role('alert')).to_have_text('这都答不对的人是不配领救济的')
        expect(dialog.locator('.arithmetic')).not_to_have_text(question)
        expect(dialog.get_by_label('算术题答案')).to_have_value('')
        expect(dialog.get_by_label('算术题答案')).to_be_focused()
        expect(page.locator('.wallet')).to_have_attribute('title', '0 Tokens')
    page.screenshot(path=str(OUT/'relief-wrong-new-question-320.png'), full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    answer = sum(map(int, re.findall(r'\d+', dialog.locator('.arithmetic').inner_text())))
    dialog.get_by_label('算术题答案').fill(str(answer))
    dialog.get_by_role('button', name='领取 10 KTokens', exact=True).click()
    expect(dialog).to_have_count(0)
    for tab in [page, sibling]:
        expect(tab.locator('.wallet')).to_have_attribute('title', '10000 Tokens')
    page.reload()
    expect(page.locator('.wallet')).to_have_attribute('title', '10000 Tokens')
    assert not errors, errors
    print('PASS relief: two wrong answers rotate questions, exact taunt, cleared/focused input, correct answer grants 10K, cross-tab sync and reload', flush=True)
    browser.close()
