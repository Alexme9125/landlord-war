"""Cross-engine layout and touch acceptance against a built production server."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE=os.environ.get('GAME_URL','http://127.0.0.1:3181')
OUT=Path(os.environ.get('SCREENSHOT_DIR','/tmp/landlord-screenshots'))
OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    for name in ['chromium','webkit','firefox']:
        browser=getattr(p,name).launch(headless=True)
        mobile=name!='firefox'
        context=browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 900},has_touch=mobile,is_mobile=mobile,reduced_motion='reduce')
        page=context.new_page();errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(BASE)
        expect(page.get_by_role('button',name='开始练习',exact=True)).to_be_enabled()
        expect(page.locator('html')).to_have_attribute('data-theme','light')
        page.get_by_role('button',name='癞子玩法',exact=True).click()
        expect(page.locator('html')).to_have_attribute('data-theme','light')
        page.reload()
        expect(page.get_by_role('button',name='癞子玩法',exact=True)).to_have_attribute('aria-pressed','true')
        expect(page.locator('html')).to_have_attribute('data-theme','light')
        page.get_by_role('button',name='切换深色主题',exact=True).click()
        page.get_by_role('button',name='标准玩法',exact=True).click()
        expect(page.locator('html')).to_have_attribute('data-theme','dark')
        page.reload()
        expect(page.locator('html')).to_have_attribute('data-theme','dark')
        page.get_by_role('button',name='天地癞子',exact=True).click()
        expect(page.locator('html')).to_have_attribute('data-theme','dark')
        page.reload()
        expect(page.get_by_role('button',name='天地癞子',exact=True)).to_have_attribute('aria-pressed','true')
        expect(page.locator('html')).to_have_attribute('data-theme','dark')
        if mobile:
            for width in [320,390]:
                page.set_viewport_size({'width':width,'height':844})
                hero=page.locator('.table-hero').bounding_box()
                spec=page.locator('.table-spec').bounding_box()
                cards=page.locator('.hero-card').evaluate_all('(els)=>els.map(e=>e.getBoundingClientRect().toJSON())')
                assert all(c['left']>=hero['x'] and c['right']<=hero['x']+hero['width'] and c['bottom']<=spec['y'] for c in cards), cards
        ai_name=page.get_by_role('textbox',name='对手1名字',exact=True)
        ai_name.fill('一二三四五六七八九十一二三四五六')
        ai_name.press('Tab')
        difficulty=page.get_by_role('group',name='对手1难度').get_by_role('button',name='凌厉',exact=True)
        if mobile: difficulty.tap()
        else: difficulty.click()
        page.get_by_role('group',name='对手1流派').get_by_role('button',name='平衡',exact=True).click()
        page.reload()
        expect(ai_name).to_have_value('一二三四五六七八九十一二三四五六')
        expect(difficulty).to_have_attribute('aria-pressed','true')
        page.screenshot(path=str(OUT/f'{name}-production-home.png'),full_page=True)
        page.get_by_role('button',name='开始练习',exact=True).click()
        expect(page.locator('.hand [data-card]').first).to_be_visible()
        expect(page.get_by_label('天地癞子点数')).to_be_visible()
        expect(page.locator('.seat-ai-style').filter(has_text='凌厉 / 平衡')).to_be_visible()
        expect(page.locator('html')).to_have_attribute('data-theme','dark')
        card=page.locator('.hand [data-card]').first
        if mobile:
            rect=card.bounding_box();page.touchscreen.tap(rect['x']+5,rect['y']+9)
        else:card.click(position={'x':5,'y':9})
        expect(card).to_have_attribute('aria-pressed','true')
        page.get_by_role('button',name='取消选牌').click()
        expect(card).to_have_attribute('aria-pressed','false')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.screenshot(path=str(OUT/f'{name}-production-game.png'),full_page=True)
        if mobile:
            page.set_viewport_size({'width':320,'height':780})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.screenshot(path=str(OUT/f'{name}-production-game-320.png'),full_page=True)
            page.set_viewport_size({'width':844,'height':390})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            assert page.locator('.hand').bounding_box()['y']+page.locator('.hand').bounding_box()['height']<=390
            page.screenshot(path=str(OUT/f'{name}-production-landscape.png'),full_page=True)
        # Leave control is intentionally icon-only at narrow widths.
        page.locator('.room-toolbar > button').click()
        page.get_by_role('button',name='离开',exact=True).click()
        expect(page.get_by_role('button',name='开始练习',exact=True)).to_be_visible()
        assert not errors,errors
        print(f'PASS {name}: production identity/socket/PVE, theme, selection/cancel, viewport, leave; no JS errors',flush=True)
        browser.close()
