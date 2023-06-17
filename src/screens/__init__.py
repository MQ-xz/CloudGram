from kivy.uix.screenmanager import ScreenManager
from .login_screen import LoginScreen
from .home_screen import HomeScreen


def screens():
    sm = ScreenManager()
    sm.add_widget(LoginScreen(name="login"))
    sm.add_widget(HomeScreen(name="home"))

    return sm
