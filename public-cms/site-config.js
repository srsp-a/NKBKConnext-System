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
    '/terms/': '525',
    '/customer-login/': '1263',
    '/terms-conditions/': '525',
    '/privacy-policy/': '3',
    '/pdpa/': '3',
    '/agenda/': '13575',
    '/cookies-policy/': '9142',
    '/app/': '9208'
  },
  wpLegacy: 'https://nkbkcoop.com',
  og: {
    siteName: 'NKBKCOOP',
    description:
      'สหกรณ์ออมทรัพย์สาธารณสุขหนองคาย จำกัด — ข่าวสาร บริการสมาชิก แจ้งโอนเงิน ดาวน์โหลดเอกสาร',
    image:
      'https://res.cloudinary.com/dzs7zbikj/image/upload/c_pad,b_white,w_1200,h_630,f_jpg,q_auto/v1770613894/site-config/vd64o0efi0hdpetkzyrf.png'
  },
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
  mapUrl: 'https://maps.app.goo.gl/FhT4ThAC2VPwt7dm9',
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
  payment: {
    banks: [
      {
        value: '0994000375891 พร้อมเพย์',
        label: 'พร้อมเพย์',
        account: '0994000375891',
        icon: 'wallet',
        logoUrl:
          'https://res.cloudinary.com/dzs7zbikj/image/upload/v1777910843/6789cc7973863d34426baf54_678316f2a65ae45dd6a22f9f_678303b39e0a1b2f05c23bc4_673ac03613ce1d036f897c16_thaiqr_logosimbolo_chvgzt.png'
      },
      {
        value: '413-1-00856-4 ธ.กรุงไทย สาขาหนองคาย',
        label: 'ธ.กรุงไทย สาขาหนองคาย',
        account: '413-1-00856-4',
        icon: 'bank',
        logoUrl:
          'https://res.cloudinary.com/dzs7zbikj/image/upload/v1778185285/next_jhsxfs.png'
      },
      {
        value: '980-6-21826-4 ธ.กรุงไทย สาขาสี่แยกบึงกาฬ',
        label: 'ธ.กรุงไทย สาขาสี่แยกบึงกาฬ',
        account: '980-6-21826-4',
        icon: 'bank',
        logoUrl:
          'https://res.cloudinary.com/dzs7zbikj/image/upload/v1778185285/next_jhsxfs.png'
      }
    ],
    transferTypes: [
      ['deposit', 'typeDeposit'],
      ['shares', 'typeShares'],
      ['loan', 'typeLoan'],
      ['membership', 'typeMembership'],
      ['fund', 'typeFund'],
      ['other', 'typeOther']
    ]
  },
  contact: {
    hoursTh: 'วันจันทร์–วันศุกร์: 08:30 น. – 16:30 น.',
    hoursEn: 'Monday–Friday: 8:30 AM – 4:30 PM',
    fax: '042-420740',
    mobile: ['087-8604004', '089-8619198'],
    mapEmbed:
      'https://www.google.com/maps?q=17.8675463,102.7564733&hl=th&z=16&output=embed'
  },
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
        team: 'คณะกรรมการสหกรณ์',
        management: 'ทำเนียบฝ่ายจัดการ',
        agenda: 'วาระและรายงานการประชุม',
        aboutUs: 'เกี่ยวกับสหกรณ์',
        download: 'ดาวน์โหลด',
        payment: 'แจ้งโอนเงิน',
        contact: 'ติดต่อเรา',
        faq: 'คำถามที่พบบ่อย',
        terms: 'ข้อกำหนดและเงื่อนไข',
        privacy: 'นโยบายความเป็นส่วนตัว',
        pdpa: 'PDPA',
        login: 'เข้าสู่ระบบสมาชิก'
      },
      hero: {
        tagline: 'มั่นคง โปร่งใส ใส่ใจสมาชิก',
        headline:
          'สหกรณ์ออมทรัพย์<br><span class="kb-hero-v2-title-accent">สาธารณสุขหนองคาย จำกัด</span>',
        sub:
          'สหกรณ์ออมทรัพย์เพื่อสวัสดิการสมาชิก มุ่งมั่นพัฒนาบริการทางการเงินอย่างโปร่งใส ยึดหลักธรรมาภิบาล และดูแลผลประโยชน์ของสมาชิกเป็นสำคัญ',
        ctaLogin: 'เข้าสู่ระบบสมาชิก',
        ctaApp: 'ดาวน์โหลด NKBKConnext',
        badgeTitle: 'มั่นคง โปร่งใส',
        badgeSub: 'ใส่ใจบริการเพื่อสมาชิก',
        stackChip: 'สหกรณ์ • เปิดบริการ',
        stackCaption: 'สหกรณ์ฯ หนองคาย',
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
        appTitle: 'NKBKConnext',
        appHeadline: 'แอปพลิเคชันสมาชิก NKBKConnext',
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
        views: 'เข้าชม',
        back: 'กลับรายการข่าว',
        empty: 'ยังไม่มีข่าวในหมวดนี้',
        prev: 'ก่อนหน้า',
        next: 'ถัดไป',
        pageOf: 'หน้า {page} จาก {total}',
        pagination: 'การแบ่งหน้าข่าว',
        searchLabel: 'ค้นหาข่าว',
        searchPlaceholder: 'พิมพ์หัวข้อข่าว...',
        searchBtn: 'ค้นหา',
        searchEmpty: 'ไม่พบข่าวที่ตรงกับคำค้นหา'
      },
      agenda: {
        downloadHint: 'ดาวน์โหลด',
        agendaDoc: 'วาระการประชุม',
        reportDoc: 'รายงานการประชุม'
      },
      download: {
        intro:
          'ดาวน์โหลดแบบฟอร์มและเอกสารสำคัญของสหกรณ์ — รายการที่ยังไม่มีไฟล์จะแสดงปุ่มไม่พร้อมใช้งาน',
        searchLabel: 'ค้นหาเอกสาร',
        searchPlaceholder: 'พิมพ์ชื่อแบบฟอร์มหรือคำค้นหา...',
        searchEmpty: 'ไม่พบเอกสารที่ตรงกับคำค้นหา',
        colDoc: 'เอกสาร',
        colUpdated: 'อัปเดตไฟล์ ณ วันที่แนบ',
        colAction: 'ดาวน์โหลด',
        colCount: 'จำนวนดาวน์โหลด',
        btn: 'ดาวน์โหลด',
        noFile: 'ยังไม่มีไฟล์',
        noDate: '—'
      },
      legal: {
        faqTitle: 'คำถามที่พบบ่อย',
        faqSubtitle: 'คำตอบสำหรับสมาชิกและผู้สนใจ',
        termsTitle: 'ข้อกำหนดและเงื่อนไข',
        termsSubtitle: 'การใช้งานเว็บไซต์และบริการออนไลน์',
        privacyTitle: 'นโยบายความเป็นส่วนตัว',
        privacySubtitle: 'PDPA — การคุ้มครองข้อมูลส่วนบุคคล',
        tocLabel: 'สารบัญ',
        faqTopics: 'หัวข้อคำถาม',
        searchLabel: 'ค้นหาคำถาม',
        searchPlaceholder: 'พิมพ์คำค้นหา...',
        updatedLabel: 'ปรับปรุงล่าสุด:',
        ctaText: 'ยังมีคำถาม? ติดต่อเจ้าหน้าที่ได้โดยตรง',
        ctaContact: 'ติดต่อเรา',
        ctaPhone: 'โทร 042-420750'
      },
      contact: {
        intro:
          'ติดต่อสหกรณ์ฯ สอบถามบริการ หรือส่งข้อความถึงเจ้าหน้าที่ — เราพร้อมให้บริการในวันและเวลาทำการ',
        hoursLabel: 'เวลาเปิดทำการ',
        addressLabel: 'ที่อยู่สหกรณ์',
        emailLabel: 'อีเมล',
        phoneLabel: 'โทรศัพท์',
        faxLabel: 'โทรสาร',
        mobileLabel: 'มือถือ',
        mapLabel: 'แผนที่',
        mapOpen: 'เปิดใน Google Maps',
        formTitle: 'แบบฟอร์มติดต่อ',
        formHint: 'กรอกแบบฟอร์มด้านล่าง ทีมงานจะติดต่อกลับโดยเร็วที่สุด',
        followUs: 'ช่องทางโซเชียล',
        fieldName: 'ชื่อ-นามสกุล',
        fieldEmail: 'อีเมล',
        fieldPhone: 'เบอร์โทรศัพท์',
        fieldTopic: 'หัวข้อที่ต้องการสอบถาม',
        fieldMessage: 'ข้อความ',
        topicGeneral: 'สอบถามทั่วไป',
        topicDeposit: 'เงินฝาก / บัญชี',
        topicLoan: 'เงินกู้',
        topicApp: 'แอป NKBKConnext',
        topicOther: 'อื่นๆ',
        submit: 'ส่งข้อความ',
        sending: 'กำลังส่ง...',
        success: 'ส่งข้อความเรียบร้อยแล้ว ขอบคุณที่ติดต่อเรา',
        error: 'ไม่สามารถส่งได้ กรุณาลองใหม่อีกครั้ง',
        required: 'กรุณากรอกข้อมูลที่จำเป็น',
        privacy: 'ข้อมูลของท่านจะถูกใช้เพื่อติดต่อกลับเท่านั้น'
      },
      payment: {
        intro: 'แจ้งการโอนเงินฝาก หุ้น หรือชำระหนี้ — กรุณากรอกข้อมูลให้ครบถ้วนและแนบสลิปเพื่อให้เจ้าหน้าที่ตรวจสอบได้รวดเร็ว',
        step1: 'โอนเงินเข้าบัญชีสหกรณ์',
        step2: 'กรอกแบบฟอร์มแจ้งโอน',
        step3: 'รอเจ้าหน้าที่ตรวจสอบ',
        accountsTitle: 'บัญชีรับโอน',
        accountsHint: 'กดไอคอนคัดลอกเพื่อคัดลอกเลขบัญชี',
        formTitle: 'แบบฟอร์มแจ้งโอนเงิน',
        formHint: 'กรอกข้อมูลตามสลิปการโอน — ฟิลด์ที่มี * จำเป็นต้องกรอก',
        fieldName: 'ชื่อ-สกุล',
        fieldMember: 'เลขที่สมาชิก',
        fieldPhone: 'โทรศัพท์',
        fieldAmount: 'จำนวนเงิน',
        fieldType: 'รายการโอน',
        fieldBank: 'บัญชีที่โอนเข้า',
        fieldBankPlaceholder: '— เลือกบัญชี —',
        fieldDate: 'วันที่โอน',
        fieldDateHint: 'วัน/เดือน/ปี (พ.ศ.) เช่น 21/05/2569',
        fieldTime: 'เวลาที่โอน',
        dateInvalid: 'รูปแบบวันที่ไม่ถูกต้อง — ใช้ วัน/เดือน/ปี พ.ศ. เช่น 21/05/2569',
        dateFuture: 'วันที่โอนต้องไม่เกินวันนี้',
        fieldNote: 'ข้อความเพิ่มเติม',
        fieldSlip: 'สลิปการโอน',
        slipHint: 'ลากไฟล์มาวาง หรือเลือกรูปสลิป',
        slipPick: 'เลือกรูปสลิป',
        slipMax: 'รองรับ JPG, PNG ไม่เกิน 5 MB',
        typeDeposit: 'โอนเงินฝาก',
        typeShares: 'โอนซื้อหุ้น',
        typeLoan: 'โอนชำระหนี้',
        typeMembership: 'โอนค่าสมัครสมาชิก',
        typeFund: 'โอนชำระกองทุน',
        typeOther: 'โอนรายการอื่นๆ',
        submit: 'ยืนยันแจ้งโอนเงิน',
        sending: 'กำลังส่ง...',
        success: 'แจ้งโอนเงินเรียบร้อยแล้ว ขอบคุณครับ',
        error: 'ส่งไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
        required: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบ',
        slipTooBig: 'ไฟล์สลิปใหญ่เกิน 5 MB',
        privacy: 'ข้อมูลและสลิปใช้เพื่อตรวจสอบการโอนเท่านั้น',
        lineBanner: 'เปิดจาก LINE แล้ว? สามารถแจ้งผ่านแชทได้เช่นกัน'
      },
      appPage: {
        pageTitle: 'วิธีดาวน์โหลด/วิธีสมัครใช้บริการ App NKBKConnext',
        pageSubtitle: 'ดาวน์โหลดแอป สมัครใช้งาน และเริ่มต้นใช้บริการสมาชิกบนมือถือ',
        kicker: 'แอปสมาชิก',
        heroTitle: 'NKBKConnext',
        heroDesc: 'ตรวจสอบยอดเงินฝาก เงินกู้ แจ้งโอน และรับข่าวสารจากสหกรณ์ — ใช้งานได้ทุกที่ทุกเวลา',
        f1: 'ตรวจสอบยอดบัญชีแบบเรียลไทม์',
        f2: 'แจ้งโอนเงินและชำระเงินกู้',
        f3: 'รับข่าวสารและประกาศจากสหกรณ์',
        appStore: 'App Store',
        googlePlay: 'Google Play',
        videoTitle: 'วิดีโอแนะนำการใช้งาน',
        videoDesc: 'ชมขั้นตอนการดาวน์โหลดและสมัครใช้บริการแอป NKBKConnext',
        videoFallback: 'เบราว์เซอร์ของคุณไม่รองรับการเล่นวิดีโอ',
        stepsTitle: 'ขั้นตอนการใช้งาน',
        stepsDesc: 'ทำตามภาพด้านล่างทีละขั้นตอน — จากดาวน์โหลดจนถึงเข้าใช้งานได้',
        stepLabel: 'ขั้นตอนที่',
        ctaTitle: 'พร้อมเริ่มใช้งานแล้ว?',
        ctaDesc: 'ดาวน์โหลด NKBKConnext ได้ทั้ง iOS และ Android'
      },
      footer: {
        company: 'เกี่ยวกับองค์กร',
        support: 'ช่วยเหลือ',
        address: 'ที่ตั้งสหกรณ์',
        copyright: 'สงวนลิขสิทธิ์',
        hotlineLabel: 'สายด่วนสหกรณ์',
        tagline: 'บริการทุกระดับประทับใจ',
        followUs: 'ติดตามเรา',
        appTitle: 'NKBKConnext',
        appCaption: 'ดาวน์โหลด NKBKConnext',
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
        terms: 'Terms & Conditions',
        privacy: 'Privacy Policy',
        pdpa: 'PDPA',
        login: 'Member login'
      },
      hero: {
        tagline: 'Stable · Transparent · Member-focused',
        headline:
          'Nongkhai Public Health<br><span class="kb-hero-v2-title-accent">Savings Cooperative Limited</span>',
        sub:
          'A savings cooperative dedicated to member welfare — transparent financial services, good governance, and sustainable growth.',
        ctaLogin: 'Member login',
        ctaApp: 'Download NKBKConnext',
        badgeTitle: 'Stable & transparent',
        badgeSub: 'Service with heart for members',
        stackChip: 'Co-op • Open',
        stackCaption: 'Cooperative, Nong Khai',
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
        appTitle: 'NKBKConnext',
        appHeadline: 'NKBKConnext member app',
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
        views: 'Views',
        back: 'Back to news',
        empty: 'No news in this category',
        prev: 'Previous',
        next: 'Next',
        pageOf: 'Page {page} of {total}',
        pagination: 'News pagination',
        searchLabel: 'Search news',
        searchPlaceholder: 'Type a headline...',
        searchBtn: 'Search',
        searchEmpty: 'No news matches your search'
      },
      agenda: {
        downloadHint: 'Download',
        agendaDoc: 'Meeting agenda',
        reportDoc: 'Meeting report'
      },
      download: {
        intro:
          'Download cooperative forms and documents. Items without a file show a disabled button.',
        searchLabel: 'Search documents',
        searchPlaceholder: 'Type a form name or keyword...',
        searchEmpty: 'No documents match your search',
        colDoc: 'Document',
        colUpdated: 'File updated',
        colAction: 'Download',
        colCount: 'Downloads',
        btn: 'Download',
        noFile: 'No file yet',
        noDate: '—'
      },
      legal: {
        faqTitle: 'Frequently asked questions',
        faqSubtitle: 'Answers for members and visitors',
        termsTitle: 'Terms & Conditions',
        termsSubtitle: 'Website and online service use',
        privacyTitle: 'Privacy Policy',
        privacySubtitle: 'PDPA — personal data protection',
        tocLabel: 'Contents',
        faqTopics: 'Topics',
        searchLabel: 'Search questions',
        searchPlaceholder: 'Type to search...',
        updatedLabel: 'Last updated:',
        ctaText: 'Still have questions? Contact us directly.',
        ctaContact: 'Contact us',
        ctaPhone: 'Call 042-420750'
      },
      contact: {
        intro:
          'Contact the cooperative for enquiries or send us a message — we are available during office hours.',
        hoursLabel: 'Office hours',
        addressLabel: 'Cooperative address',
        emailLabel: 'Email',
        phoneLabel: 'Telephone',
        faxLabel: 'Fax',
        mobileLabel: 'Mobile',
        mapLabel: 'Map',
        mapOpen: 'Open in Google Maps',
        formTitle: 'Contact form',
        formHint: 'Fill in the form below and our team will get back to you soon.',
        followUs: 'Social channels',
        fieldName: 'Full name',
        fieldEmail: 'Email',
        fieldPhone: 'Phone',
        fieldTopic: 'Topic',
        fieldMessage: 'Message',
        topicGeneral: 'General enquiry',
        topicDeposit: 'Deposits / accounts',
        topicLoan: 'Loans',
        topicApp: 'NKBKConnext app',
        topicOther: 'Other',
        submit: 'Send message',
        sending: 'Sending...',
        success: 'Thank you — your message has been sent.',
        error: 'Could not send. Please try again.',
        required: 'Please fill in required fields',
        privacy: 'Your details are used only to respond to your enquiry.'
      },
      payment: {
        intro: 'Notify us of your transfer for deposits, shares, or loan payments. Complete the form and attach your slip for faster processing.',
        step1: 'Transfer to a cooperative account',
        step2: 'Submit this notification form',
        step3: 'Wait for staff verification',
        accountsTitle: 'Receiving accounts',
        accountsHint: 'Tap copy to copy the account number',
        formTitle: 'Transfer notification',
        formHint: 'Enter details as shown on your slip — * required fields',
        fieldName: 'Full name',
        fieldMember: 'Member ID',
        fieldPhone: 'Phone',
        fieldAmount: 'Amount',
        fieldType: 'Transfer type',
        fieldBank: 'Destination account',
        fieldBankPlaceholder: '— Select account —',
        fieldDate: 'Transfer date',
        fieldDateHint: 'DD/MM/YYYY (B.E.) e.g. 21/05/2569',
        fieldTime: 'Transfer time',
        dateInvalid: 'Invalid date — use DD/MM/YYYY (B.E.) e.g. 21/05/2569',
        dateFuture: 'Transfer date cannot be in the future',
        fieldNote: 'Additional note',
        fieldSlip: 'Payment slip',
        slipHint: 'Drag & drop or choose an image',
        slipPick: 'Choose slip image',
        slipMax: 'JPG or PNG, max 5 MB',
        typeDeposit: 'Savings deposit',
        typeShares: 'Share purchase',
        typeLoan: 'Loan repayment',
        typeMembership: 'Membership fee',
        typeFund: 'Fund payment',
        typeOther: 'Other',
        submit: 'Submit notification',
        sending: 'Sending...',
        success: 'Thank you — your transfer notification has been received.',
        error: 'Could not submit. Please try again.',
        required: 'Please complete all required fields',
        slipTooBig: 'Slip file exceeds 5 MB',
        privacy: 'Your data and slip are used only for verification.',
        lineBanner: 'Opened from LINE? You may also notify us via chat.'
      },
      appPage: {
        pageTitle: 'How to download & register — NKBKConnext app',
        pageSubtitle: 'Download, sign up, and start using member services on your phone',
        kicker: 'Member app',
        heroTitle: 'NKBKConnext',
        heroDesc: 'Check balances, loans, transfer notices, and cooperative news — anytime, anywhere.',
        f1: 'Real-time account balances',
        f2: 'Transfer notices & loan payments',
        f3: 'News and announcements',
        appStore: 'App Store',
        googlePlay: 'Google Play',
        videoTitle: 'How-to video',
        videoDesc: 'Watch how to download and register for the NKBKConnext app',
        videoFallback: 'Your browser does not support video playback',
        stepsTitle: 'Step-by-step guide',
        stepsDesc: 'Follow each screenshot from download to your first login',
        stepLabel: 'Step',
        ctaTitle: 'Ready to get started?',
        ctaDesc: 'Download NKBKConnext on iOS and Android'
      },
      footer: {
        company: 'Organization',
        support: 'Support',
        address: 'Cooperative location',
        copyright: 'All rights reserved',
        hotlineLabel: 'Cooperative hotline',
        tagline: 'Service you can trust',
        followUs: 'Follow us',
        appTitle: 'NKBKConnext',
        appCaption: 'Download NKBKConnext',
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
