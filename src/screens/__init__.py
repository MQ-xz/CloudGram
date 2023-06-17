"""All screen register here"""
from kivy.uix.screenmanager import ScreenManager
from .login_screen import LoginScreen
from .home_screen import HomeScreen


def screens() -> ScreenManager:
    """register screens"""

    _screen = ScreenManager()
    _screen.add_widget(LoginScreen(name="login"))
    _screen.add_widget(HomeScreen(name="home"))

    return _screen
