"""AI settings, touch/keyboard capsules, persistence, and a full new-AI match."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('GAME_URL', 'http://127.0.0.1:3185')
OUT = Path(os.environ.get('SCREENSHOT_DIR', '/tmp/landlord-screenshots/ai'))
OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width':1440,'height':1100}, reduced_motion='reduce', has_touch=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE)
    expect(page.get_by_role('button',name='开始练习',exact=True)).to_be_enabled(timeout=15000)
    def choose(i, group, value):
        section = page.get_by_role('group',name=f'对手{i}{group}',exact=True)
        section.get_by_role('button',name=value,exact=True).tap()
        expect(section.locator('[aria-pressed=true]')).to_have_count(1)
        expect(section.get_by_role('button',name=value,exact=True)).to_have_attribute('aria-pressed','true')
    for i in [1,2]:
        expect(page.get_by_role('group',name=f'对手{i}难度').get_by_role('button',name='温和',exact=True)).to_have_attribute('aria-pressed','true')
        for difficulty in ['恍惚','温和','凌厉']:
            choose(i,'难度',difficulty)
            for persona in ['谨慎','平衡','激进']:
                choose(i,'流派',persona)
    name1 = page.get_by_role('textbox',name='对手1名字',exact=True)
    name2 = page.get_by_role('textbox',name='对手2名字',exact=True)
    name1.fill('  青石  ')
    name1.press('Enter')
    expect(name1).to_have_value('青石')
    name2.fill('')
    name2.press('Tab')
    expect(name2).to_have_value('见山')
    name2.fill('晚风')
    name2.press('Enter')
    choose(1,'难度','凌厉')
    choose(1,'流派','激进')
    choose(2,'难度','温和')
    choose(2,'流派','谨慎')
    page.get_by_role('button',name='天地癞子',exact=True).click()
    page.reload()
    expect(name1).to_have_value('青石')
    expect(name2).to_have_value('晚风')
    expect(page.get_by_role('group',name='对手1难度').get_by_role('button',name='凌厉',exact=True)).to_have_attribute('aria-pressed','true')
    expect(page.get_by_role('group',name='对手2难度').get_by_role('button',name='温和',exact=True)).to_have_attribute('aria-pressed','true')
    # Keyboard activation uses the same buttons and preserves visible focus.
    keyboard = page.get_by_role('group',name='对手2流派').get_by_role('button',name='平衡',exact=True)
    keyboard.focus()
    keyboard.press('Space')
    expect(keyboard).to_have_attribute('aria-pressed','true')
    expect(keyboard).to_be_focused()
    choose(2,'流派','谨慎')
    for width,height in [(1440,1100),(390,844),(320,780)]:
        page.set_viewport_size({'width':width,'height':height})
        for theme in ['light','dark']:
            if page.locator('html').get_attribute('data-theme')!=theme:
                page.get_by_role('button',name='切换深色主题' if theme=='dark' else '切换浅色主题').click()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'home overflow'
            for box in page.locator('.ai-capsules').all():
                bounds=box.bounding_box()
                assert bounds['x']>=0 and bounds['x']+bounds['width']<=width
            page.screenshot(path=str(OUT/f'ai-home-{theme}-{width}.png'),full_page=True)
    page.get_by_role('button',name='开始练习',exact=True).click()
    expect(page.locator('.hand')).to_be_visible()
    for name,caption in [('青石','凌厉 / 激进'),('晚风','温和 / 谨慎')]:
        seat=page.locator('.seat').filter(has=page.get_by_text(name,exact=True))
        expect(seat).to_contain_text(caption)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'room overflow'
    page.screenshot(path=str(OUT/'ai-room-320.png'),full_page=True)
    page.set_viewport_size({'width':1440,'height':1000})
    page.screenshot(path=str(OUT/'ai-room-desktop.png'),full_page=True)
    def click(name):
        button=page.get_by_role('button',name=name,exact=True)
        if button.count() and button.is_visible() and button.is_enabled():
            button.click()
            return True
        return False
    for tick in range(1500):
        if page.get_by_role('dialog',name='这一局，落定').count(): break
        acted=any(click(name) for name in ['叫地主','抢地主 ×2','不加倍'])
        hint=page.get_by_role('button',name='提示',exact=True)
        if not acted and hint.count() and hint.is_enabled():
            hint.click()
            expect(hint).to_be_enabled(timeout=10000)
            if not click('出牌'): click('不出')
            elif page.get_by_role('dialog',name='选择这手牌的解释').count():
                page.locator('.interpretation').first.click()
        page.wait_for_timeout(150)
    expect(page.get_by_role('dialog',name='这一局，落定')).to_be_visible(timeout=5000)
    expect(page.get_by_role('dialog',name='这一局，落定')).to_contain_text('青石')
    expect(page.get_by_role('dialog',name='这一局，落定')).to_contain_text('晚风')
    page.screenshot(path=str(OUT/'ai-settlement.png'),full_page=True)
    assert not errors, errors
    print('PASS AI names, all 18 capsule combinations, persistence, keyboard/touch, 320/390/1440 themes, and full heaven-earth match',flush=True)
    browser.close()
