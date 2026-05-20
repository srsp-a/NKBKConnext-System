/** ตั้งค่า CMS — ดีไซน์แบบธนาคาร (อ้างอิงโครง KBank) */
window.CMS_SITE = {
  brandTitle: 'NKBKCOOP',
  tabTitle: 'NKBKCOOP',
  brandSubTh: 'สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด',
  brandSubEn: 'Nongkhai Public Health Savings Cooperative',
  name: 'สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด',
  nameEn: 'Nongkhai Public Health Savings And Credit Cooperatives Limited',
  nameShort: 'สหกรณ์ออมทรัพย์หนองคาย',
  nameShortEn: 'NKBK Cooperative',
  homePageId: '27',
  cmsPages: {
    '/team/': '420',
    '/management/': '8929',
    '/about-us/': '241',
    '/download/': '7934',
    '/infrom-payment/': '9304',
    '/infrom-payment-line/': '9304',
    '/contact/': '354',
    '/faq/': '294',
    '/customer-login/': '1263',
    '/terms-conditions/': '525',
    '/privacy-policy/': '3',
    '/agenda/': '13575',
    '/cookies-policy/': '9142',
    '/app/': '9208'
  },
  wpLegacy: 'https://nkbkcoop.com',
  logos: {
    header:
      'https://res.cloudinary.com/dzs7zbikj/image/upload/v1770613894/site-config/vd64o0efi0hdpetkzyrf.png',
    footer:
      'https://res.cloudinary.com/dzs7zbikj/image/upload/v1770613894/site-config/vd64o0efi0hdpetkzyrf.png',
    favicon:
      'https://res.cloudinary.com/dzs7zbikj/image/upload/w_32,h_32,c_fit,f_png,q_auto/v1770613894/site-config/vd64o0efi0hdpetkzyrf.png'
  },
  heroImage: '/assets/img/hero-sps0100.png',
  heroAppImage: '/assets/img/hero-app.png',
  footerAppImages: [
    '/assets/img/footer-app-1.png',
    '/assets/img/footer-app-2.png'
  ],
  appStoreIos:
    'https://apps.apple.com/th/app/nkbkconnext/id1554206325?l=th',
  appStoreAndroid:
    'https://play.google.com/store/apps/details?id=com.nkhsaving.mobile',
  heroImages: [
    '/assets/img/hero-sps0100.png',
    '/assets/img/hero-sps0036.png',
    '/assets/img/hero-sps0073.png',
    '/assets/img/hero-sps0062.png'
  ],
  mapUrl:
    'https://www.google.com/maps/search/?api=1&query=919+หมู่+5+ต.โพธิ์ชัย+อ.เมืองหนองคาย',
  interestRates: {
    deposit: [
      {
        labelTh: 'ออมทรัพย์ (สามัญ)',
        labelEn: 'Savings (ordinary)',
        rate: '3.00',
        popular: true
      },
      { labelTh: 'ออมทรัพย์ (สมทบ)', labelEn: 'Savings (contribution)', rate: '2.75' },
      { labelTh: 'ออมทรัพย์ ATM', labelEn: 'ATM savings', rate: '3.00' }
    ],
    loanOrdinary: [
      { labelTh: 'สามัญ', labelEn: 'Ordinary', rate: '6.55' },
      {
        labelTh: 'สามัญสำหรับภาระค้ำประกัน',
        labelEn: 'Ordinary (guarantee obligation)',
        rate: '0.50'
      },
      {
        labelTh: 'สามัญเพื่อการดำรงชีพ',
        labelEn: 'Ordinary (livelihood)',
        rate: '6.55'
      },
      { labelTh: 'สามัญผู้สูงอายุ', labelEn: 'Ordinary (elderly)', rate: '5.75' },
      {
        labelTh: 'สามัญเพื่อพัฒนาคุณภาพชีวิต',
        labelEn: 'Ordinary (quality of life)',
        rate: '6.55'
      },
      {
        labelTh: 'สามัญเพื่อเกษียณสุขใจ',
        labelEn: 'Ordinary (retirement)',
        rate: '6.55'
      },
      {
        labelTh: 'สามัญรวมหนี้',
        labelEn: 'Ordinary (debt consolidation)',
        rate: '6.55'
      }
    ],
    loanSpecial: [
      { labelTh: 'ฉุกเฉิน', labelEn: 'Emergency', rate: '6.65' },
      { labelTh: 'ฉุกเฉิน ATM', labelEn: 'Emergency ATM', rate: '6.65' },
      {
        labelTh: 'พิเศษโดยใช้หุ้นค้ำประกัน',
        labelEn: 'Special (share collateral)',
        rate: '6.00'
      },
      {
        labelTh: 'พิเศษเพื่อการศึกษา',
        labelEn: 'Special (education)',
        rate: '6.35'
      },
      {
        labelTh: 'พิเศษเพื่อการลงทุนประกอบอาชีพ',
        labelEn: 'Special (livelihood investment)',
        rate: '6.35'
      },
      {
        labelTh: 'พิเศษเพื่อการเคหะสงเคราะห์',
        labelEn: 'Special (housing)',
        rate: '6.35'
      }
    ]
  },
  downloadPatches: [],
  agendaPatches: [
    {
      match: 'การประชุมใหญ่สามัญ ประจำปี 2568',
      agendaUrl: '',
      reportUrl: '/assets/docs/report-agm-2568.pdf'
    },
    {
      match: 'การประชุมใหญ่วิสามัญ ประจำปี 2568',
      reportUrl: '/assets/docs/report-egm-2568.pdf'
    },
    {
      match: 'การประชุมใหญ่สามัญ ประจำปี 2567',
      reportUrl: '/assets/docs/report-agm-2567.pdf'
    }
  ],
  externalPartners: [
    {
      nameTh: 'สำนักงานสาธารณสุข จังหวัดหนองคาย',
      nameEn: 'Nong Khai Provincial Public Health Office',
      url: 'https://wwwnko.moph.go.th/main_new/',
      logo: '/assets/img/partners/nko-moph.png'
    },
    {
      nameTh: 'สำนักงานสาธารณสุข จังหวัดบึงกาฬ',
      nameEn: 'Bueng Kan Provincial Public Health Office',
      url: 'https://bkpho.moph.go.th/bungkanpho/',
      logo: '/assets/img/partners/bkpho.png'
    },
    {
      nameTh: 'ชุมนุมสหกรณ์ออมทรัพย์แห่งประเทศไทย',
      nameEn: 'Federation of Savings and Credit Cooperatives of Thailand',
      url: 'http://www.fsct.com/fsct_main.php',
      logo: '/assets/img/partners/fsct.png'
    },
    {
      nameTh: 'สมาคมฌาปนกิจสงเคราะห์สมาชิกสหกรณ์ออมทรัพย์สาธารณสุขไทย',
      nameEn: 'Public Health Savings Cooperative Member Cremation Association',
      url: 'http://www.cpct.or.th/',
      logo: '/assets/img/partners/cpct.png'
    },
    {
      nameTh:
        'สมาคมฌาปนกิจสงเคราะห์สหกรณ์สมาชิกของชุมนุมสหกรณ์ออมทรัพย์แห่งประเทศไทย',
      nameEn:
        'Cremation Association for Members of the Federation of Savings and Credit Cooperatives',
      url: 'http://www.fscct.or.th/',
      logo: '/assets/img/partners/fscct.png'
    },
    {
      nameTh: 'สำนักงานสหกรณ์จังหวัดหนองคาย',
      nameEn: 'Nong Khai Provincial Cooperative Office',
      url: 'http://web.cpd.go.th/nongkhai/',
      logo: '/assets/img/partners/cpd-nk.png'
    },
    {
      nameTh: 'สำนักงานตรวจบัญชีสหกรณ์หนองคาย',
      nameEn: 'Nong Khai Cooperative Auditing Office',
      url: 'http://www.cadnk.com/',
      logo: '/assets/img/partners/cadnk.png'
    }
  ],
  homeStats: [
    { icon: 'users', tone: 'purple', value: '3,285', suffixTh: ' คน', suffixEn: '', labelTh: 'สมาชิกทั้งหมด', labelEn: 'Total members' },
    { icon: 'shield', tone: 'blue', value: '1,248', suffixTh: ' ล้านบาท', suffixEn: 'M THB', labelTh: 'ทุนเรือนหมุน', labelEn: 'Operating capital' },
    { icon: 'chart', tone: 'green', value: '982', suffixTh: ' ล้านบาท', suffixEn: 'M THB', labelTh: 'เงินกู้รวม', labelEn: 'Total loans' },
    { icon: 'bank', tone: 'orange', value: '1,756', suffixTh: ' ล้านบาท', suffixEn: 'M THB', labelTh: 'เงินฝากรวม', labelEn: 'Total deposits' }
  ],
  facebook: 'https://www.facebook.com/sahakon.nkbk',
  line: 'https://page.line.me/117kkqhx?openQrModal=true',
  youtube: 'https://www.youtube.com/@nkbkcoop',
  phone: '+6642420750',
  phoneDisplay: '042-420750',
  email: 'support@nkbkcoop.com',
  address: '919 หมู่ 5 ต.โพธิ์ชัย อ.เมืองหนองคาย จ.หนองคาย 43000',
  addressEn:
    '919 Moo 5, Phochai Sub-district, Mueang Nong Khai, Nong Khai 43000',
  newsCategories: [
    {
      slug: 'command-announce',
      labelTh: 'ประกาศ/คำสั่งสหกรณ์/ประชาสัมพันธ์',
      labelEn: 'Announcements & PR'
    },
    {
      slug: 'fundnews',
      labelTh: 'ข่าวกองทุนสวัสดิการฯ',
      labelEn: 'Welfare Fund News'
    },
    {
      slug: 'activity',
      labelTh: 'อัลบั้มกิจกรรม',
      labelEn: 'Activity Album'
    }
  ],
  i18n: {
    th: {
      topbar: { hotline: 'สายด่วน', search: 'ค้นหา' },
      nav: {
        menu: 'เมนู',
        home: 'หน้าหลัก',
        news: 'ข่าวสาร',
        newsAll: 'ข่าวทั้งหมด',
        about: 'เกี่ยวกับเรา',
        services: 'บริการของเรา',
        team: 'คณะกรรมการดำเนินการ',
        management: 'ทำเนียบฝ่ายจัดการ',
        agenda: 'วาระและรายงานการประชุม',
        aboutUs: 'เกี่ยวกับสหกรณ์',
        download: 'ดาวน์โหลด',
        payment: 'แจ้งโอนเงิน',
        contact: 'ติดต่อเรา',
        faq: 'คำถามที่พบบ่อย',
        login: 'เข้าสู่ระบบสมาชิก'
      },
      hero: {
        tagline: 'มั่นคง โปร่งใส ใส่ใจสมาชิก',
        headline:
          'สหกรณ์ออมทรัพย์<br><span class="kb-hero-v2-title-accent">สาธารณสุขหนองคาย จำกัด</span>',
        sub:
          'สหกรณ์ออมทรัพย์เพื่อสวัสดิการสมาชิก มุ่งมั่นพัฒนาบริการทางการเงินอย่างโปร่งใส ยึดหลักธรรมาภิบาล และดูแลผลประโยชน์ของสมาชิกเป็นสำคัญ',
        ctaLogin: 'เข้าสู่ระบบสมาชิก',
        ctaApp: 'ดาวน์โหลด NKBKConnect',
        badgeTitle: 'มั่นคง โปร่งใส',
        badgeSub: 'ใส่ใจบริการเพื่อสมาชิก',
        stackChip: 'สหกรณ์ • เปิดบริการ',
        stackCaption: 'สำนักงานใหญ่ หนองคาย',
        stackMeta: 'บริการครบ • โปร่งใส',
        floatSecureTitle: 'บริการออนไลน์',
        floatSecureSub: 'พร้อมใช้งานทุกวัน',
        floatMembersTitle: 'สมาชิก 3,285+',
        floatMembersSub: 'ทั่วจังหวัดหนองคาย'
      },
      home: {
        servicesTitle: 'บริการยอดนิยม',
        servicesSub: '',
        svc1Title: 'บัญชีเงินฝาก',
        svc1Desc: 'ออมทรัพย์ ฝากประจำ และบัญชีพิเศษ',
        svc2Title: 'เงินกู้สามัญ',
        svc2Desc: 'เงินกู้เพื่อสวัสดิการและความจำเป็น',
        svc3Title: 'แจ้งโอนเงิน',
        svc3Desc: 'แจ้งชำระเงินกู้และหุ้นสะสม',
        svc4Title: 'ดาวน์โหลดเอกสาร',
        svc4Desc: 'แบบฟอร์มและเอกสารสำคัญ',
        svc5Title: 'ข่าวและกิจกรรม',
        svc5Desc: 'ติดตามข่าวสารล่าสุด',
        svc6Title: 'ติดต่อสหกรณ์',
        svc6Desc: 'สอบถามและติดต่อเจ้าหน้าที่',
        ratesTitle: 'อัตราดอกเบี้ย',
        ratesSub: 'อัตราดอกเบี้ยเงินฝากและเงินกู้',
        ratesMore: 'ดูทั้งหมด',
        ratesDeposit: 'อัตราดอกเบี้ยเงินฝาก',
        ratesLoan: 'อัตราดอกเบี้ยเงินกู้',
        perYear: 'ร้อยละ/ปี',
        perYearUnit: 'ต่อปี',
        popularBadge: 'ยอดนิยม',
        partnersTitle: 'ลิงก์หน่วยงานภายนอก',
        newsTitle: 'ข่าวสารและประกาศ',
        newsMore: 'ดูข่าวทั้งหมด',
        appTitle: 'NKBKConnect',
        appHeadline: 'แอปพลิเคชันสมาชิก NKBKConnect',
        appDesc: 'ตรวจสอบยอดเงินฝาก เงินกู้ และทำธุรกรรมได้สะดวกทุกที่ทุกเวลา',
        appF1: 'ตรวจสอบยอดบัญชีแบบเรียลไทม์',
        appF2: 'แจ้งโอนเงินและชำระเงินกู้',
        appF3: 'รับข่าวสารและประกาศจากสหกรณ์',
        appDownload: 'ดาวน์โหลดเลย'
      },
      news: {
        title: 'ข่าวสารและประกาศ',
        subtitle: 'ประกาศ · ข่าวสาร · กิจกรรม · ประชาสัมพันธ์',
        categories: 'หมวดข่าว',
        readMore: 'อ่านต่อ',
        back: 'กลับรายการข่าว',
        empty: 'ยังไม่มีข่าวในหมวดนี้'
      },
      agenda: {
        downloadHint: 'ดาวน์โหลด',
        agendaDoc: 'วาระการประชุม',
        reportDoc: 'รายงานการประชุม'
      },
      download: {
        intro:
          'ดาวน์โหลดแบบฟอร์มและเอกสารสำคัญของสหกรณ์ — รายการที่ยังไม่มีไฟล์จะแสดงปุ่มไม่พร้อมใช้งาน',
        colDoc: 'เอกสาร',
        colUpdated: 'อัปเดตไฟล์ ณ วันที่แนบ',
        colAction: 'ดาวน์โหลด',
        colCount: 'จำนวนดาวน์โหลด',
        btn: 'ดาวน์โหลด',
        noFile: 'ยังไม่มีไฟล์',
        noDate: '—'
      },
      footer: {
        company: 'เกี่ยวกับองค์กร',
        support: 'ช่วยเหลือ',
        address: 'ที่ตั้งสำนักงาน',
        copyright: 'สงวนลิขสิทธิ์',
        hotlineLabel: 'สายด่วนสหกรณ์',
        tagline: 'บริการทุกระดับประทับใจ',
        followUs: 'ติดตามเรา',
        appTitle: 'NKBKConnect',
        appCaption: 'ดาวน์โหลด NKBKConnect',
        appDesc: 'บริการสหกรณ์บนมือถือ ตรวจยอด กู้ โอน ได้ทุกที่ทุกเวลา',
        storeIosHint: 'ดาวน์โหลดบน',
        storeIos: 'App Store',
        storeAndroidHint: 'ดาวน์โหลดที่',
        storeAndroid: 'Google Play'
      },
      misc: { loading: 'กำลังโหลด...', notFound: 'ไม่พบข้อมูล' }
    },
    en: {
      topbar: { hotline: 'Hotline', search: 'Search' },
      nav: {
        menu: 'Menu',
        home: 'Home',
        news: 'News',
        newsAll: 'All news',
        about: 'About us',
        services: 'Services',
        team: 'Board',
        management: 'Management',
        agenda: 'Meeting agenda & reports',
        aboutUs: 'About',
        download: 'Download',
        payment: 'Transfer',
        contact: 'Contact',
        faq: 'FAQ',
        login: 'Member login'
      },
      hero: {
        tagline: 'Stable · Transparent · Member-focused',
        headline:
          'Nongkhai Public Health<br><span class="kb-hero-v2-title-accent">Savings Cooperative Limited</span>',
        sub:
          'A savings cooperative dedicated to member welfare — transparent financial services, good governance, and sustainable growth.',
        ctaLogin: 'Member login',
        ctaApp: 'Download NKBKConnect',
        badgeTitle: 'Stable & transparent',
        badgeSub: 'Service with heart for members',
        stackChip: 'Co-op • Open',
        stackCaption: 'Head office, Nong Khai',
        stackMeta: 'Full services · Transparent',
        floatSecureTitle: 'Online services',
        floatSecureSub: 'Available every day',
        floatMembersTitle: '3,285+ members',
        floatMembersSub: 'Across Nong Khai'
      },
      home: {
        servicesTitle: 'Popular services',
        servicesSub: '',
        svc1Title: 'Savings accounts',
        svc1Desc: 'Savings, fixed deposits & special accounts',
        svc2Title: 'Ordinary loans',
        svc2Desc: 'Loans for welfare and necessities',
        svc3Title: 'Transfer notice',
        svc3Desc: 'Notify loan and share payments',
        svc4Title: 'Downloads',
        svc4Desc: 'Forms and important documents',
        svc5Title: 'News & events',
        svc5Desc: 'Latest updates from the cooperative',
        svc6Title: 'Contact us',
        svc6Desc: 'Reach our staff for assistance',
        ratesTitle: 'Interest rates',
        ratesSub: 'Deposit and loan rates',
        ratesMore: 'View all',
        ratesDeposit: 'Deposit rates',
        ratesLoan: 'Loan rates',
        perYear: '% p.a.',
        perYearUnit: 'per year',
        popularBadge: 'Popular',
        partnersTitle: 'External agency links',
        newsTitle: 'News & announcements',
        newsMore: 'View all',
        appTitle: 'NKBKConnect',
        appHeadline: 'NKBKConnect member app',
        appDesc: 'Check balances, loans, and transact anywhere, anytime.',
        appF1: 'Real-time account balances',
        appF2: 'Transfer notices & loan payments',
        appF3: 'News and announcements',
        appDownload: 'Download now'
      },
      news: {
        title: 'News & announcements',
        subtitle: 'Announcements · News · Activities · PR',
        categories: 'Categories',
        readMore: 'Read more',
        back: 'Back to news',
        empty: 'No news in this category'
      },
      agenda: {
        downloadHint: 'Download',
        agendaDoc: 'Meeting agenda',
        reportDoc: 'Meeting report'
      },
      download: {
        intro:
          'Download cooperative forms and documents. Items without a file show a disabled button.',
        colDoc: 'Document',
        colUpdated: 'File updated',
        colAction: 'Download',
        colCount: 'Downloads',
        btn: 'Download',
        noFile: 'No file yet',
        noDate: '—'
      },
      footer: {
        company: 'Organization',
        support: 'Support',
        address: 'Office address',
        copyright: 'All rights reserved',
        hotlineLabel: 'Cooperative hotline',
        tagline: 'Service you can trust',
        followUs: 'Follow us',
        appTitle: 'NKBKConnect',
        appCaption: 'Download NKBKConnect',
        appDesc: 'Mobile cooperative services — balances, loans, and transfers anytime.',
        storeIosHint: 'Download on the',
        storeIos: 'App Store',
        storeAndroidHint: 'Get it on',
        storeAndroid: 'Google Play'
      },
      misc: { loading: 'Loading...', notFound: 'Not found' }
    }
  }
};
