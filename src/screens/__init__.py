"""All screen register here"""
from kivy.uix.screenmanager import ScreenManager
from .login_screen import LoginScreen
from .home_screen import HomeScreen

# from src.utils.telegram import telegram


def screens() -> ScreenManager:
    """register screens"""
    # telegram.connect()
    _screen = ScreenManager()
    # if telegram.get_me():
    #     _screen.add_widget(HomeScreen(name="home"))
    #     return _screen
    # _screen.add_widget(LoginScreen(name="login"))
    _screen.add_widget(HomeScreen(name="home"))
    return _screen
