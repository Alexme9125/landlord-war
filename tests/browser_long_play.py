"""Fixed eighteen-card lead in all seat perspectives, engines, and pause states."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_layout import assert_no_overflow

BASE = os.environ.get('GAME_URL', 'http://127.0.0.1:3184')
OUT = Path(os.environ.get('SCREENSHOT_DIR', '/tmp/landlord-screenshots/long-play'))
OUT.mkdir(parents=True, exist_ok=True)
fixture = json.loads(Path(os.environ['HEAVEN_FIXTURE']).read_text())


def check_layout(page, prefix):
    cards = page.locator('.current-play .played-cards .playing-card')
    expect(cards).to_have_count(18)
    assert_no_overflow(page, prefix)
    group = page.locator('.current-play .played-cards').bounding_box()
    bounds = cards.evaluate_all('(cards)=>cards.map(c=>c.getBoundingClientRect().toJSON())')
    page.screenshot(path=str(prefix) + '.png', full_page=True)
    # Hiding page overflow would conceal cards; every card must fit its group.
    assert all(card['left'] >= group['x'] - 0.5 and
               card['right'] <= group['x'] + group['width'] + 0.5 and
               card['bottom'] <= group['y'] + group['height'] + 0.5
               for card in bounds), (group, bounds)


with sync_playwright() as p:
    for name in ['webkit', 'chromium', 'firefox']:
        browser = getattr(p, name).launch(headless=True)
        pages = []
        errors = []
        for token in fixture['longPlayTokens']:
            context = browser.new_context(viewport={'width':390,'height':844}, has_touch=True, reduced_motion='reduce')
            context.add_cookies([{'name':'clear_session','value':token,'url':BASE,'httpOnly':True,'sameSite':'Lax'}])
            page = context.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(BASE)
            expect(page.locator('.current-play .played-label')).to_contain_text('连对')
            expect(page.locator('.hand [data-card]')).to_have_count(2 if not pages else 17)
            pages.append(page)
        for index, page in enumerate(pages):
            for width, height in [(320,780), (390,844), (844,390), (1280,900)]:
                page.set_viewport_size({'width':width,'height':height})
                check_layout(page, OUT/f'long-play-{name}-seat-{index}-{width}')
        # The original failure appeared after pausing with the AI's long lead
        # still on the table. Verify both the live and paused layouts.
        pages[1].get_by_role('button', name='暂停对局', exact=True).tap()
        for index, page in enumerate(pages):
            expect(page.get_by_role('status', name='对局已暂停', exact=True)).to_be_visible()
            page.set_viewport_size({'width':390,'height':844})
            check_layout(page, OUT/f'long-play-{name}-paused-{index}')
        pages[1].get_by_role('button', name='继续对局', exact=True).tap()
        expect(pages[1].get_by_role('button', name='提示', exact=True)).to_be_enabled()
        assert not errors, errors
        print(f'PASS {name}: fixed 18-card pairs, three perspectives, 320/390/844/1280px, live/pause/resume, all cards inside their group', flush=True)
        browser.close()
