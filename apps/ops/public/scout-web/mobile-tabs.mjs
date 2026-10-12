const mobile = matchMedia('(max-width:600px),(max-height:520px) and (orientation:landscape)');
const serving = document.getElementById('serving-tools');
const rallyBar = document.querySelector('.rally-bar');
const players = document.getElementById('players');
const dockButtons = ["first-fault", "double-fault", "var-review", "undo"].map(id => {
  const button = document.getElementById(id), anchor = document.createComment(id + " original position");
  button.before(anchor);
  return {button, anchor};
});
function positionServer() {
  for (const {button, anchor} of dockButtons) {
    if (mobile.matches) { if (button.parentElement !== rallyBar) rallyBar.append(button); }
    else if (button.parentElement === rallyBar) anchor.after(button);
  }
  const divider = players.querySelector('.court-divider');
  const target = mobile.matches && divider ? divider : rallyBar;
  if (serving.parentElement !== target) target.append(serving);
}
new MutationObserver(positionServer).observe(players, {childList:true});
mobile.addEventListener('change', () => {
  positionServer();
  if (!mobile.matches) document.body.classList.remove('mobile-stats-open');
});
positionServer();
document.getElementById('mobile-open-stats').onclick = () => {
  document.getElementById('scouting-menu').close();
  document.body.classList.add('mobile-stats-open');
  document.getElementById('mobile-back-scout').focus();
};
document.getElementById('mobile-back-scout').onclick = () => {
  document.body.classList.remove('mobile-stats-open');
  document.getElementById('scouting-menu-button').focus();
};
document.getElementById('rally').addEventListener('click', () => document.body.classList.remove('mobile-stats-open'));
