export const THEMES=[
 {id:'dark',name:'ChatGPT',scheme:'dark',fontSize:16,description:'Clean sans-serif · 16 px · soft white on charcoal.'},
 {id:'light',name:'Claude',scheme:'light',fontSize:17,description:'Warm serif · 17 px · dark ink on paper.'}
];
export const normalizeTheme=theme => ['light','sand'].includes(theme) ? 'light' : 'dark';
