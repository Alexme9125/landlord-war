"""Play a real twelve-card bomb and verify all three perspectives against the isolated fixture server."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('GAME_URL', 'http://127.0.0.1:3184')
OUT = Path(os.environ.get('SCREENSHOT_DIR', '/tmp/landlord-screenshots/heaven-earth'))
OUT.mkdir(parents=True, exist_ok=True)
fixture = json.loads(Path(os.environ['HEAVEN_FIXTURE']).read_text())
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    pages = []
    errors = []
    for token in fixture['tokens']:
        context = browser.new_context(viewport={'width':390,'height':844}, reduced_motion='reduce')
        context.add_cookies([{'name':'clear_session','value':token,'url':BASE,'httpOnly':True,'sameSite':'Lax'}])
        page = context.new_page()
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(BASE)
        expect(page.get_by_label('天地癞子点数')).to_contain_text('天癞子 7')
        expect(page.get_by_label('天地癞子点数')).to_contain_text('地癞子 9')
        pages.append(page)
    host = pages[0]
    expect(host.locator('.hand [aria-label*="天癞子"]')).to_have_count(4)
    expect(host.locator('.hand [aria-label*="地癞子"]')).to_have_count(4)
    expect(host.locator('.multiplier strong')).to_have_text('×15')
    for card in fixture['selected']:
        host.locator(f'.hand [data-card="{card}"]').click(position={'x':5,'y':7})
    host.get_by_role('button',name='出牌',exact=True).click()
    if host.get_by_role('dialog',name='选择这手牌的解释').count():
        host.locator('.interpretation').filter(has_text='12张软炸弹').click()
    for index, page in enumerate(pages):
        expect(page.locator('.multiplier strong')).to_have_text('×90')
        expect(page.locator('.current-play .played-cards .playing-card')).to_have_count(12)
        expect(page.locator('.current-play .played-label')).to_contain_text('12张软炸弹')
        for width,height in [(320,780),(390,844),(844,390)]:
            page.set_viewport_size({'width':width,'height':height})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            indicator=page.get_by_label('天地癞子点数').bounding_box()
            stake=page.locator('.multiplier .stake-value').bounding_box()
            assert indicator['y'] >= stake['y'] + stake['height'] + 2
            bounds=page.locator('.current-play .playing-card').evaluate_all('(cards)=>cards.map(c=>({left:c.getBoundingClientRect().left,right:c.getBoundingClientRect().right}))')
            assert all(card['left'] >= 0 and card['right'] <= width for card in bounds), bounds
            page.screenshot(path=str(OUT/f'long-bomb-seat-{index}-{width}.png'),full_page=True)
    host.locator('.multiplier').click()
    expect(host.get_by_role('dialog',name='本局倍率记录')).to_contain_text('12张软炸弹')
    expect(host.get_by_role('dialog',name='本局倍率记录')).to_contain_text('×6')
    host.get_by_role('button',name='关闭',exact=True).click()
    host.reload()
    expect(host.locator('.hand [data-card]')).to_have_count(8)
    expect(host.locator('.multiplier strong')).to_have_text('×90')
    assert not errors,errors
    print('PASS twelve-card bomb: both badges, all-player x6, multiplier ledger, three perspectives at 320/390/844 widths, reconnect; no JS errors',flush=True)
    browser.close()
